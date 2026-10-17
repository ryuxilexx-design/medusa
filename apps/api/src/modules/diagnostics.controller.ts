import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { uziReportSchema } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { conflict, forbidden, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { now } from '../core/clock';

const SELECT = `
  SELECT o.id, o.service_name, o.status, o.ordered_at, o.branch_id, b.name AS branch_name, o.patient_id, p.patient_number, p.last_name, p.first_name, p.birth_date, p.sex,
         od.display_name AS ordered_by, o.performer_doctor_id, pd.display_name AS performer_name,
         dr.id AS report_id, dr.exam_type, dr.description, dr.conclusion, dr.specialist_name, dr.status AS report_status, dr.signed_at, dr.updated_at, dr.template_version
    FROM service_orders o JOIN patients p ON p.id = o.patient_id JOIN branches b ON b.id = o.branch_id
    LEFT JOIN doctors od ON od.id = o.doctor_id LEFT JOIN doctors pd ON pd.id = o.performer_doctor_id LEFT JOIN diagnostic_reports dr ON dr.order_id = o.id`;

/** UZI reports: the performing specialist writes and signs; ordering/treating doctors read. Other roles have no clinical access. */
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private db: Db) {}

  private visibility(ctx: Ctx, params: unknown[]) {
    params.push(ctx.doctorId);
    const i = params.length;
    return `(o.performer_doctor_id = $${i} OR o.doctor_id = $${i} OR EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = o.patient_id AND a.doctor_id = $${i}))`;
  }

  @Roles('doctor') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const params: unknown[] = [ctx.tenantId, ctx.branchIds];
    const where = ['o.tenant_id = $1', 'o.branch_id = ANY($2)', `o.category = 'ultrasound'`, this.visibility(ctx, params)];
    if (q.status === 'draft') where.push(`(dr.status IS NULL OR dr.status = 'draft')`);
    if (q.status === 'signed') where.push(`dr.status = 'signed'`);
    const rows = await this.db.rows(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY (dr.status = 'signed') NULLS FIRST, o.ordered_at DESC LIMIT 200`, params);
    return { data: rows.map((r) => ({ ...r, description: undefined, conclusion: r.report_status === 'signed' || r.performer_doctor_id === ctx.doctorId ? r.conclusion : null })) };
  }

  private async load(q: Q, ctx: Ctx, id: string, lock = false) {
    if (!isUuid(id)) throw notFound('UZI buyurtmasi');
    const params: unknown[] = [id, ctx.tenantId, ctx.branchIds];
    const vis = this.visibility(ctx, params);
    const r = (await q.query(`${SELECT} WHERE o.id = $1 AND o.tenant_id = $2 AND o.branch_id = ANY($3) AND o.category = 'ultrasound' AND ${vis} ${lock ? 'FOR UPDATE OF o' : ''}`, params)).rows[0];
    if (!r) throw notFound('UZI buyurtmasi');
    return r;
  }

  @Roles('doctor') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const r = await this.load(this.db.pool, ctx, id);
    if (r.report_status !== 'signed' && r.performer_doctor_id !== ctx.doctorId) { r.description = null; r.conclusion = null; }
    return { data: { ...r, can_edit: r.performer_doctor_id === ctx.doctorId && r.report_status !== 'signed' } };
  }

  @Roles('doctor') @Put(':id')
  async save(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(uziReportSchema, body);
    return this.db.tx(async (c) => {
      const r = await this.load(c, ctx, id, true);
      if (r.performer_doctor_id !== ctx.doctorId) throw forbidden('Xulosani faqat UZI mutaxassisi yozadi');
      if (r.report_status === 'signed') throw conflict('IMMUTABLE', 'Tasdiqlangan xulosani o‘zgartirib bo‘lmaydi');
      await c.query(
        `INSERT INTO diagnostic_reports (tenant_id, order_id, exam_type, description, conclusion, specialist_name, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7)
         ON CONFLICT (order_id) DO UPDATE SET description = EXCLUDED.description, conclusion = EXCLUDED.conclusion, updated_at = EXCLUDED.updated_at
         WHERE diagnostic_reports.status = 'draft'`, [ctx.tenantId, id, r.service_name, input.description, input.conclusion, ctx.name, now()]);
      return { data: { ok: true, saved_at: now() } };
    });
  }

  @Roles('doctor') @Post(':id/sign') @HttpCode(200)
  async sign(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(uziReportSchema, body);
    if (!input.description || !input.conclusion) throw invalid({ ...(input.description ? {} : { description: 'Tavsif to‘ldirilishi shart' }), ...(input.conclusion ? {} : { conclusion: 'Xulosa to‘ldirilishi shart' }) });
    return this.db.tx(async (c) => {
      const r = await this.load(c, ctx, id, true);
      if (r.performer_doctor_id !== ctx.doctorId) throw forbidden('Xulosani faqat UZI mutaxassisi tasdiqlaydi');
      if (r.report_status === 'signed') throw conflict('IMMUTABLE', 'Xulosa allaqachon tasdiqlangan');
      const t = now();
      await c.query(
        `INSERT INTO diagnostic_reports (tenant_id, order_id, exam_type, description, conclusion, specialist_name, status, signed_by, signed_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'signed',$7,$8,$8)
         ON CONFLICT (order_id) DO UPDATE SET description = EXCLUDED.description, conclusion = EXCLUDED.conclusion, status = 'signed', signed_by = EXCLUDED.signed_by,
           signed_at = EXCLUDED.signed_at, updated_at = EXCLUDED.updated_at WHERE diagnostic_reports.status = 'draft'`,
        [ctx.tenantId, id, r.service_name, input.description, input.conclusion, ctx.name, ctx.membershipId, t]);
      if (r.status === 'ordered') await c.query(`UPDATE service_orders SET status = 'completed', performed_at = $2 WHERE id = $1`, [id, t]);
      await audit(c, ctx, 'diagnostic_report.sign', 'order', id, `UZI xulosasi tasdiqlandi: ${r.service_name}`, r.branch_id);
      return { data: { ok: true, signed_at: t } };
    });
  }
}
