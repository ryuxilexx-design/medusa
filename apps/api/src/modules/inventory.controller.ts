import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { inventoryMovementSchema } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { localToUtc, now, today } from '../core/clock';
import { branchScope } from '../core/scope';

const QTY = `i.opening_qty + coalesce((SELECT sum(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END) FROM inventory_movements m WHERE m.item_id = i.id),0)`;

@Controller('inventory')
export class InventoryController {
  constructor(private db: Db) {}

  @Roles('manager') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const rows = await this.db.rows(
      `SELECT * FROM (SELECT i.id, i.name, i.unit, i.opening_qty, i.minimum_qty, b.name AS branch_name,
              coalesce((SELECT sum(quantity) FROM inventory_movements m WHERE m.item_id = i.id AND m.type = 'in'),0) AS in_qty,
              coalesce((SELECT sum(quantity) FROM inventory_movements m WHERE m.item_id = i.id AND m.type = 'out'),0) AS out_qty,
              ${QTY} AS qty
         FROM inventory_items i JOIN branches b ON b.id = i.branch_id WHERE i.tenant_id = $1 AND i.branch_id = ANY($2)) x
        WHERE ($3::boolean IS NOT TRUE OR qty < minimum_qty) ORDER BY (qty < minimum_qty) DESC, name`,
      [ctx.tenantId, branchScope(ctx, q.branch_id), q.low === '1']);
    return { data: rows };
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
