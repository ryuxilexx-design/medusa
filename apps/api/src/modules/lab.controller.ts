import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { labResultSchema } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { conflict, forbidden, invalid, notFound } from '../core/errors';
import { isDate, isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, now } from '../core/clock';
import { branchScope } from '../core/scope';

const ORDER_SELECT = `
  SELECT o.id, o.branch_id, b.name AS branch_name, o.patient_id, p.patient_number, p.last_name, p.first_name, p.birth_date, p.sex,
         o.service_id, o.service_name, o.category, o.status, o.ordered_at, o.price_snapshot, o.encounter_id, o.appointment_id,
         d.display_name AS ordered_by, lr.collected_at, lr.collected_by_name, lr.entered_at, lr.entered_by_name, lr.verified_at, lr.verified_by_name, lr.comment,
         lr.values, s.lab_template
    FROM service_orders o JOIN patients p ON p.id = o.patient_id JOIN branches b ON b.id = o.branch_id JOIN services s ON s.id = o.service_id
    LEFT JOIN doctors d ON d.id = o.doctor_id LEFT JOIN lab_results lr ON lr.order_id = o.id`;

/** Strip result values for roles that may only see the status. */
function shape(ctx: Ctx, o: any) {
  if (ctx.role === 'lab') return o;
  if (ctx.role === 'doctor' && o.status === 'verified') return o;
  const { values, lab_template, comment, ...rest } = o; void values; void lab_template; void comment;
  return rest;
}

async function lockLabOrder(q: Q, ctx: Ctx, id: string) {
  if (!isUuid(id)) throw notFound('Buyurtma');
  const o = (await q.query(`SELECT o.*, s.lab_template FROM service_orders o JOIN services s ON s.id = o.service_id
      WHERE o.id = $1 AND o.tenant_id = $2 AND o.category = 'lab' FOR UPDATE OF o`, [id, ctx.tenantId])).rows[0];
  if (!o || !ctx.branchIds.includes(o.branch_id)) throw notFound('Buyurtma');
  return o;
}

@Controller('orders')
export class LabController {
  constructor(private db: Db) {}

  @Roles('lab', 'manager', 'registrar', 'doctor') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const build = (withStatus: boolean) => {
      const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), q.category === 'ultrasound' ? 'ultrasound' : 'lab'];
      const where = ['o.tenant_id = $1', 'o.branch_id = ANY($2)', 'o.category = $3'];
      if (isDate(q.from)) { params.push(dayStart(q.from)); where.push(`o.ordered_at >= $${params.length}`); }
      if (isDate(q.to)) { params.push(dayStart(addDays(q.to, 1))); where.push(`o.ordered_at < $${params.length}`); }
      if (withStatus && q.status) { params.push(String(q.status).split(',')); where.push(`o.status = ANY($${params.length})`); }
      if (isUuid(q.patient_id)) { params.push(q.patient_id); where.push(`o.patient_id = $${params.length}`); }
      if (q.search) { params.push(`%${String(q.search).trim().toLowerCase()}%`); where.push(`(lower(p.last_name || ' ' || p.first_name) LIKE $${params.length} OR p.patient_number::text LIKE $${params.length})`); }
      if (ctx.role === 'doctor') { params.push(ctx.doctorId); where.push(`EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = o.patient_id AND a.doctor_id = $${params.length})`); }
      return { params, where };
    };
    const { params, where } = build(true);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM service_orders o JOIN patients p ON p.id = o.patient_id WHERE ${where.join(' AND ')}`, params))!.n;
    const cs = build(false);
    const counts = await this.db.rows(`SELECT o.status, count(*)::int AS n FROM service_orders o JOIN patients p ON p.id = o.patient_id WHERE ${cs.where.join(' AND ')} GROUP BY 1`, cs.params);
    params.push(pageSize, offset);
    const rows = await this.db.rows(`${ORDER_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY CASE o.status WHEN 'ordered' THEN 0 WHEN 'sample_collected' THEN 1 WHEN 'draft_result' THEN 2 ELSE 3 END, o.ordered_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { data: rows.map((r) => shape(ctx, r)), meta: { page, page_size: pageSize, total, counts } };
  }

  @Roles('lab', 'manager', 'registrar', 'doctor') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Buyurtma');
    const o = await this.db.one(`${ORDER_SELECT} WHERE o.id = $1 AND o.tenant_id = $2 AND o.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!o) throw notFound('Buyurtma');
    if (ctx.role === 'doctor') {
      const ok = await this.db.one(`SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2 LIMIT 1`, [o.patient_id, ctx.doctorId]);
      if (!ok) throw forbidden('Bu bemor sizga biriktirilmagan');
    }
    return { data: shape(ctx, o) };
  }

  @Roles('lab') @Post(':id/collect') @HttpCode(200)
  async collect(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const o = await lockLabOrder(c, ctx, id);
      if (o.status === 'sample_collected') return { data: { id, already: true } };
      if (o.status !== 'ordered') throw conflict('STALE_STATE', 'Buyurtma holati o‘zgargan. Sahifani yangilang.');
      await c.query(`INSERT INTO lab_results (tenant_id, order_id, values, status, collected_at, collected_by_name) VALUES ($1,$2,'[]','draft',$3,$4)`, [ctx.tenantId, id, now(), ctx.name]);
      await c.query(`UPDATE service_orders SET status = 'sample_collected' WHERE id = $1`, [id]);
      await audit(c, ctx, 'lab.collect', 'order', id, `Namuna olindi: ${o.service_name}`, o.branch_id);
      return { data: { id } };
    });
  }

  @Roles('lab') @Put(':id/result')
  async saveResult(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(labResultSchema, body);
    return this.db.tx(async (c) => {
      const o = await lockLabOrder(c, ctx, id);
      if (o.status === 'verified') throw conflict('IMMUTABLE', 'Tasdiqlangan natijani o‘zgartirib bo‘lmaydi');
      if (!['sample_collected', 'draft_result'].includes(o.status)) throw conflict('INVALID_STATE', 'Avval namuna olinganini belgilang');
      const template: any[] = o.lab_template ?? [];
      const fields: Record<string, string> = {};
      const values = template.map((p, i) => {
        const v = input.values.find((x) => x.code === p.code)?.value ?? '';
        if (v !== '' && !/^-?\d+([.,]\d+)?$/.test(v)) fields[`values.${i}`] = `${p.name}: son kiriting`;
        const num = Number(v.replace(',', '.'));
        const flag = v === '' ? null : p.ref_low != null && num < p.ref_low ? 'low' : p.ref_high != null && num > p.ref_high ? 'high' : 'normal';
        return { code: p.code, name: p.name, unit: p.unit, ref_low: p.ref_low, ref_high: p.ref_high, value: v.replace(',', '.'), flag };
      });
      if (Object.keys(fields).length) throw invalid(fields);
      await c.query(`UPDATE lab_results SET values = $2, comment = $3, entered_at = $4, entered_by_name = $5 WHERE order_id = $1`, [id, JSON.stringify(values), input.comment, now(), ctx.name]);
      await c.query(`UPDATE service_orders SET status = 'draft_result' WHERE id = $1`, [id]);
      return { data: { id, values } };
    });
  }

  @Roles('lab') @Post(':id/verify') @HttpCode(200)
  async verify(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const o = await lockLabOrder(c, ctx, id);
      if (o.status === 'verified') return { data: { id, already: true } };
      if (o.status !== 'draft_result') throw conflict('INVALID_STATE', 'Avval natijani kiriting va qoralamani saqlang');
      const r = (await c.query(`SELECT values FROM lab_results WHERE order_id = $1`, [id])).rows[0];
      const empty = (r.values as any[]).filter((v) => v.value === '' || v.value == null);
      if (!r.values.length || empty.length) throw invalid({ values: `Barcha parametrlar to‘ldirilishi kerak (${empty.map((e: any) => e.name).join(', ')})` });
      const t = now();
      await c.query(`UPDATE lab_results SET status = 'verified', verified_by = $2, verified_by_name = $3, verified_at = $4 WHERE order_id = $1`, [id, ctx.membershipId, ctx.name, t]);
      await c.query(`UPDATE service_orders SET status = 'verified', performed_at = $2 WHERE id = $1`, [id, t]);
      await audit(c, ctx, 'lab_result.verify', 'order', id, `${o.service_name} tasdiqlandi`, o.branch_id);
      return { data: { id, verified_at: t } };
    });
  }
}
