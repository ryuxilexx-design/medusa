import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { inventoryItemCreateSchema, inventoryItemPatchSchema, inventoryMovementSchema } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { conflict, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { localToUtc, now, today } from '../core/clock';
import { assertBranch, branchScope } from '../core/scope';

const QTY = `i.opening_qty + coalesce((SELECT sum(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END) FROM inventory_movements m WHERE m.item_id = i.id),0)`;

@Controller('inventory')
export class InventoryController {
  constructor(private db: Db) {}

  @Roles('manager') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const rows = await this.db.rows(
      `SELECT * FROM (SELECT i.id, i.name, i.unit, i.opening_qty, i.minimum_qty, i.active, i.branch_id, b.name AS branch_name,
              coalesce((SELECT sum(quantity) FROM inventory_movements m WHERE m.item_id = i.id AND m.type = 'in'),0) AS in_qty,
              coalesce((SELECT sum(quantity) FROM inventory_movements m WHERE m.item_id = i.id AND m.type = 'out'),0) AS out_qty,
              ${QTY} AS qty
         FROM inventory_items i JOIN branches b ON b.id = i.branch_id WHERE i.tenant_id = $1 AND i.branch_id = ANY($2)) x
        WHERE ($3::boolean IS NOT TRUE OR (active AND qty < minimum_qty)) ORDER BY active DESC, (qty < minimum_qty) DESC, name LIMIT 1000`,
      [ctx.tenantId, branchScope(ctx, q.branch_id), q.low === '1']);
    return { data: rows };
  }

  @Roles('manager') @Post()
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(inventoryItemCreateSchema, body);
    assertBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      const b = (await c.query(`SELECT name, active FROM branches WHERE id = $1 AND tenant_id = $2`, [input.branch_id, ctx.tenantId])).rows[0];
      if (!b) throw invalid({ branch_id: 'Filial topilmadi' });
      if (!b.active) throw invalid({ branch_id: 'Filial nofaol — avval uni faollashtiring' });
      if ((await c.query(`SELECT 1 FROM inventory_items WHERE tenant_id = $1 AND branch_id = $2 AND lower(name) = lower($3)`, [ctx.tenantId, input.branch_id, input.name])).rowCount)
        throw conflict('DUPLICATE', 'Bu filialda shu nomli material allaqachon bor');
      const id = (await c.query(`INSERT INTO inventory_items (id, tenant_id, branch_id, name, unit, opening_qty, minimum_qty, active) VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ctx.tenantId, input.branch_id, input.name, input.unit, input.opening_qty, input.minimum_qty, input.active])).rows[0].id as string;
      await audit(c, ctx, 'inventory.create', 'inventory_item', id, `Material qo‘shildi: «${input.name}» (${b.name}), boshlang‘ich ${input.opening_qty} ${input.unit}`, input.branch_id);
      return { data: { id } };
    });
  }

  @Roles('manager') @Patch(':id')
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
      if (input.unit !== undefined && input.unit !== it.unit) changes.push(`birlik: ${input.unit}`);
      if (input.minimum_qty !== undefined && input.minimum_qty !== Number(it.minimum_qty)) changes.push(`minimum: ${input.minimum_qty}`);
      if (input.active !== undefined && input.active !== it.active) changes.push(input.active ? 'faol qilindi' : 'nofaol qilindi');
      await c.query(`UPDATE inventory_items SET name = $2, branch_id = $3, unit = COALESCE($4, unit), minimum_qty = COALESCE($5, minimum_qty), active = COALESCE($6, active) WHERE id = $1`,
        [id, name, branchId, input.unit ?? null, input.minimum_qty ?? null, input.active ?? null]);
      if (changes.length) await audit(c, ctx, 'inventory.update', 'inventory_item', id, `${it.name}: ${changes.join(', ')}`, branchId);
      return { data: { ok: true, changes } };
    });
  }

  @Roles('manager') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Material');
    const item = await this.db.one(`SELECT i.*, b.name AS branch_name, ${QTY} AS qty FROM inventory_items i JOIN branches b ON b.id = i.branch_id
      WHERE i.id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!item) throw notFound('Material');
    const movements = await this.db.rows(`SELECT id, type, quantity, reason, actor_name, occurred_at FROM inventory_movements WHERE item_id = $1 ORDER BY occurred_at DESC`, [id]);
    return { data: { ...item, movements } };
  }

  @Roles('manager') @Post(':id/movements')
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
      const at = input.date && input.date !== today() ? localToUtc(input.date, '12:00') : now();
      await c.query(`INSERT INTO inventory_movements (id, tenant_id, item_id, type, quantity, reason, actor_name, occurred_at) VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7)`,
        [ctx.tenantId, id, input.type, input.quantity, input.reason, ctx.name, at]);
      await audit(c, ctx, `inventory.${input.type}`, 'inventory_item', id, `${item.name}: ${input.type === 'in' ? 'kirim' : 'chiqim'} ${input.quantity} ${item.unit}`, item.branch_id);
      return { data: { ok: true } };
    });
  }
}
