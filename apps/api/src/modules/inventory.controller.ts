import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { inventoryItemCreateSchema, inventoryItemPatchSchema, inventoryMovementSchema } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { conflict, invalid, notFound } from '../core/errors';
import { isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { localToUtc, now, today } from '../core/clock';
import { assertBranch, branchScope } from '../core/scope';
import { fromC, insertMove, STOCK_SQL, takeFefo, toC } from './warehouse';

// stock = Σ batch balances (migration 030); the ledger keeps opening_qty + Σ in − Σ out equal to it
const QTY = STOCK_SQL('i');
const MOVE_COLS = 'm.id, m.type, m.kind, m.quantity, m.reason, m.actor_name, m.receiver_name, m.doc_no, m.occurred_at, m.voided_at';
const ITEM_FIELDS = 'i.category, i.storage, i.controlled, i.drug_id, i.purchase_price';

@Controller('inventory')
export class InventoryController {
  constructor(private db: Db) {}

  @Roles('manager', 'storekeeper') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const rows = await this.db.rows(
      `SELECT * FROM (SELECT i.id, i.name, i.unit, i.opening_qty, i.minimum_qty, i.active, i.branch_id, b.name AS branch_name, ${ITEM_FIELDS},
              coalesce((SELECT sum(quantity) FROM inventory_movements m WHERE m.item_id = i.id AND m.type = 'in'),0) AS in_qty,
              coalesce((SELECT sum(quantity) FROM inventory_movements m WHERE m.item_id = i.id AND m.type = 'out'),0) AS out_qty,
              ${QTY} AS qty
         FROM inventory_items i JOIN branches b ON b.id = i.branch_id WHERE i.tenant_id = $1 AND i.branch_id = ANY($2)) x
        WHERE ($3::boolean IS NOT TRUE OR (active AND qty < minimum_qty)) ORDER BY active DESC, (qty < minimum_qty) DESC, name LIMIT 1000`,
      [ctx.tenantId, branchScope(ctx, q.branch_id), q.low === '1']);
    return { data: rows };
  }

  @Roles('manager', 'storekeeper') @Post()
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(inventoryItemCreateSchema, body);
    assertBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      const b = (await c.query(`SELECT name, active FROM branches WHERE id = $1 AND tenant_id = $2`, [input.branch_id, ctx.tenantId])).rows[0];
      if (!b) throw invalid({ branch_id: 'Filial topilmadi' });
      if (!b.active) throw invalid({ branch_id: 'Filial nofaol — avval uni faollashtiring' });
      if ((await c.query(`SELECT 1 FROM inventory_items WHERE tenant_id = $1 AND branch_id = $2 AND lower(name) = lower($3)`, [ctx.tenantId, input.branch_id, input.name])).rowCount)
        throw conflict('DUPLICATE', 'Bu filialda shu nomli material allaqachon bor');
      if (input.drug_id && !(await c.query(`SELECT 1 FROM drugs WHERE id = $1`, [input.drug_id])).rowCount) throw invalid({ drug_id: 'Dori topilmadi' });
      const id = (await c.query(`INSERT INTO inventory_items (id, tenant_id, branch_id, name, unit, opening_qty, minimum_qty, active, category, storage, controlled, drug_id, purchase_price)
        VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [ctx.tenantId, input.branch_id, input.name, input.unit, input.opening_qty, input.minimum_qty, input.active, input.category, input.storage, input.controlled, input.drug_id ?? null, input.purchase_price])).rows[0].id as string;
      // the opening balance is one batch without a series (later stock arrives through receipts with series and expiry)
      if (input.opening_qty > 0) await c.query(`INSERT INTO inventory_batches (id, tenant_id, item_id, qty, received_qty, unit_cost, received_at) VALUES (gen_random_uuid(), $1,$2,$3,$3,$4,$5)`,
        [ctx.tenantId, id, fromC(toC(input.opening_qty)), input.purchase_price, now()]);
      await audit(c, ctx, 'inventory.create', 'inventory_item', id, `Material qo‘shildi: «${input.name}» (${b.name}), boshlang‘ich ${input.opening_qty} ${input.unit}`, input.branch_id);
      return { data: { id } };
    });
  }

  @Roles('manager', 'storekeeper') @Patch(':id')
  async patch(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(inventoryItemPatchSchema, body);
    if (!isUuid(id)) throw notFound('Material');
    if (input.branch_id) assertBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      const it = (await c.query(`SELECT * FROM inventory_items WHERE id = $1 AND tenant_id = $2 AND branch_id = ANY($3) FOR UPDATE`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!it) throw notFound('Material');
      const changes: string[] = [];
      const branchId = input.branch_id ?? it.branch_id;
      const name = input.name ?? it.name;
      if (input.branch_id !== undefined && input.branch_id !== it.branch_id) {
        const b = (await c.query(`SELECT name, active FROM branches WHERE id = $1 AND tenant_id = $2`, [input.branch_id, ctx.tenantId])).rows[0];
        if (!b) throw invalid({ branch_id: 'Filial topilmadi' });
        if (!b.active) throw invalid({ branch_id: 'Filial nofaol — avval uni faollashtiring' });
        changes.push(`filial: ${b.name}`);
      }
      if (input.name !== undefined && input.name !== it.name) changes.push(`nomi: «${input.name}»`);
      if ((input.name !== undefined || input.branch_id !== undefined) &&
          (await c.query(`SELECT 1 FROM inventory_items WHERE tenant_id = $1 AND branch_id = $2 AND lower(name) = lower($3) AND id <> $4`, [ctx.tenantId, branchId, name, id])).rowCount)
        throw conflict('DUPLICATE', 'Bu filialda shu nomli material allaqachon bor');
      if (input.branch_id !== undefined && input.branch_id !== it.branch_id && (await c.query(`SELECT 1 FROM inventory_batches WHERE item_id = $1 AND qty > 0`, [id])).rowCount)
        throw conflict('HAS_STOCK', 'Qoldig‘i bor materialni boshqa filialga o‘tkazib bo‘lmaydi');
      if (input.drug_id && !(await c.query(`SELECT 1 FROM drugs WHERE id = $1`, [input.drug_id])).rowCount) throw invalid({ drug_id: 'Dori topilmadi' });
      if (input.category !== undefined && input.category !== it.category) changes.push(`turi: ${input.category}`);
      if (input.storage !== undefined && input.storage !== it.storage) changes.push(`saqlash: ${input.storage}`);
      if (input.controlled !== undefined && input.controlled !== it.controlled) changes.push(input.controlled ? 'nazoratga olindi' : 'nazoratdan chiqarildi');
      if (input.purchase_price !== undefined && input.purchase_price !== Number(it.purchase_price)) changes.push(`narx: ${input.purchase_price}`);
      if (input.drug_id !== undefined && input.drug_id !== it.drug_id) changes.push('dori bog‘landi');
      if (input.unit !== undefined && input.unit !== it.unit) changes.push(`birlik: ${input.unit}`);
      if (input.minimum_qty !== undefined && input.minimum_qty !== Number(it.minimum_qty)) changes.push(`minimum: ${input.minimum_qty}`);
      if (input.active !== undefined && input.active !== it.active) changes.push(input.active ? 'faol qilindi' : 'nofaol qilindi');
      await c.query(`UPDATE inventory_items SET name = $2, branch_id = $3, unit = COALESCE($4, unit), minimum_qty = COALESCE($5, minimum_qty), active = COALESCE($6, active),
          category = COALESCE($7, category), storage = COALESCE($8, storage), controlled = COALESCE($9, controlled), purchase_price = COALESCE($10, purchase_price),
          drug_id = CASE WHEN $11 THEN $12::uuid ELSE drug_id END WHERE id = $1`,
        [id, name, branchId, input.unit ?? null, input.minimum_qty ?? null, input.active ?? null, input.category ?? null, input.storage ?? null, input.controlled ?? null,
          input.purchase_price ?? null, input.drug_id !== undefined, input.drug_id ?? null]);
      if (changes.length) await audit(c, ctx, 'inventory.update', 'inventory_item', id, `${it.name}: ${changes.join(', ')}`, branchId);
      return { data: { ok: true, changes } };
    });
  }

  @Roles('manager', 'storekeeper') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Material');
    const item = await this.db.one(`SELECT i.*, b.name AS branch_name, ${QTY} AS qty FROM inventory_items i JOIN branches b ON b.id = i.branch_id
      WHERE i.id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!item) throw notFound('Material');
    // the card shows the latest 100 movements; older ones come page by page from /inventory/:id/movements
    const movements = await this.db.rows(`SELECT ${MOVE_COLS} FROM inventory_movements m WHERE item_id = $1 ORDER BY occurred_at DESC, seq DESC LIMIT 100`, [id]);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM inventory_movements WHERE item_id = $1`, [id]))!.n;
    const batches = await this.db.rows(`SELECT id, batch_no, expiry_date, qty, received_qty, unit_cost, supplier, invoice_no, received_at, (expiry_date < $2::date) AS expired
      FROM inventory_batches WHERE item_id = $1 AND qty > 0 ORDER BY expiry_date NULLS LAST, received_at LIMIT 200`, [id, today()]);
    return { data: { ...item, purchase_price: Number(item.purchase_price), movements, movements_total: total, batches: batches.map((b) => ({ ...b, unit_cost: Number(b.unit_cost) })) } };
  }

  @Roles('manager', 'storekeeper') @Get(':id/movements')
  async movements(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    if (!isUuid(id)) throw notFound('Material');
    const { page, pageSize, offset } = pageParams(q);
    const item = await this.db.one(`SELECT id FROM inventory_items i WHERE i.id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!item) throw notFound('Material');
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM inventory_movements WHERE item_id = $1`, [id]))!.n;
    const rows = await this.db.rows(`SELECT ${MOVE_COLS} FROM inventory_movements m WHERE item_id = $1 ORDER BY occurred_at DESC, seq DESC LIMIT $2 OFFSET $3`, [id, pageSize, offset]);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  @Roles('manager', 'storekeeper') @Post(':id/movements')
  async move(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(inventoryMovementSchema, body);
    if (!isUuid(id)) throw notFound('Material');
    if (input.date && input.date > today()) throw invalid({ date: 'Kelajak sanasi mumkin emas' });
    return this.db.tx(async (c) => {
      // lock first, then count: a quantity computed inside the locking SELECT would come from the snapshot before the wait
      const locked = (await c.query(`SELECT i.id FROM inventory_items i WHERE i.id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3) FOR UPDATE`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!locked) throw notFound('Material');
      const item = (await c.query(`SELECT i.*, ${QTY} AS qty FROM inventory_items i WHERE i.id = $1`, [id])).rows[0];
      if (input.type === 'out' && input.quantity > Number(item.qty)) throw invalid({ quantity: `Mavjud qoldiqdan (${item.qty} ${item.unit}) ko‘p chiqim qilib bo‘lmaydi` });
      if (input.type === 'out' && item.controlled) throw conflict('CONTROLLED_TWO_SIGNATURES', 'Nazoratdagi dori faqat talabnoma orqali, rahbar tasdig‘i bilan beriladi');
      const at = input.date && input.date !== today() ? localToUtc(input.date, '12:00') : now();
      const qtyC = toC(input.quantity);
      // quick entry from the item card: «in» is a batch without a series; «out» is a FEFO issue to a department, taken by the person entering it
      if (input.type === 'in') {
        const batchId = (await c.query(`INSERT INTO inventory_batches (id, tenant_id, item_id, qty, received_qty, unit_cost, received_at) VALUES (gen_random_uuid(), $1,$2,$3,$3,$4,$5) RETURNING id`,
          [ctx.tenantId, id, fromC(qtyC), item.purchase_price, at])).rows[0].id;
        await insertMove(c, { tenantId: ctx.tenantId, itemId: id, branchId: item.branch_id, batchId, type: 'in', kind: 'receipt', qtyC, unitCost: item.purchase_price, reason: input.reason, actor: ctx, at, docNo: '' });
      } else {
        for (const part of await takeFefo(c, item, qtyC))
          await insertMove(c, { tenantId: ctx.tenantId, itemId: id, branchId: item.branch_id, batchId: part.batchId, type: 'out', kind: 'issue', qtyC: part.qtyC, unitCost: part.unitCost, reason: input.reason,
            actor: ctx, at, docNo: '', receiver: { id: ctx.membershipId, name: ctx.name }, purpose: { purpose: 'department', department: input.reason, patientId: null, encounterId: null, orderId: null, icdCodes: [] } });
      }
      await audit(c, ctx, `inventory.${input.type}`, 'inventory_item', id, `${item.name}: ${input.type === 'in' ? 'kirim' : 'chiqim'} ${input.quantity} ${item.unit}`, item.branch_id);
      return { data: { ok: true } };
    });
  }
}
