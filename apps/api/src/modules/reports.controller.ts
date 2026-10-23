import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { EXPENSE_PAID_FROM_LABEL } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { forbidden, notFound } from '../core/errors';
import { isUuid, pageParams } from '../core/validate';
import { branchScope } from '../core/scope';
import { csvPeriod, csvSom, csvTime, sendCsv } from '../core/csv';
import { range } from './dashboard.controller';
import { LINE_QTY, NET_LINE } from './billing';

// Performed services = consultations completed / lab verified / ultrasound & procedures completed, on non-void invoices.
const PERFORMED = `o.status IN ('completed','verified') AND i.status <> 'void'`;

@Controller()
export class ReportsController {
  constructor(private db: Db) {}

  @Roles('manager') @Get('reports/services')
  async services(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const r = range(q);
    const rows = await this.db.rows(
      `SELECT o.service_id, o.service_name, o.category, sum(${LINE_QTY})::int AS count, sum(it.line_subtotal)::bigint AS gross, sum(it.discount_share)::bigint AS discount, sum(it.line_total - ${NET_LINE})::bigint AS refunded, sum(${NET_LINE})::bigint AS value
         FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
        WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.performed_at >= $3 AND o.performed_at < $4 AND ${PERFORMED}
        GROUP BY 1,2,3 ORDER BY value DESC`, [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end]);
    return { data: rows, meta: { from: r.from, to: r.to, total: rows.reduce((a, b) => a + Number(b.value), 0) } };
  }

  /** Doctor activity and the calculated share (not payroll): Σ line value after discount × share % snapshot. */
  @Roles('manager', 'doctor') @Get('reports/doctors')
  async doctors(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const r = range(q);
    const rows = await this.doctorRows(ctx, q, r);
    return { data: rows, meta: { from: r.from, to: r.to } };
  }

  /** Doctor shares of a period as CSV (manager; bounded ≤ 1 year), with a totals row. */
  @Roles('manager') @Get('reports/doctors/export.csv')
  async doctorsCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const rows = await this.doctorRows(ctx, q, range(q));
    const value = rows.reduce((a, x) => a + BigInt(x.value), 0n), share = rows.reduce((a, x) => a + BigInt(x.share), 0n);
    sendCsv(res, `meduzai-shifokor-ulushi-${period.from}-${period.to}.csv`, ['Shifokor', 'Mutaxassislik', 'Xizmatlar', 'Qiymat (so‘m)', 'Ulush (so‘m)'],
      [...rows.map((x) => [x.name, x.specialty, x.services, csvSom(x.value), csvSom(x.share)]), ['Jami', `${rows.length} ta shifokor`, rows.reduce((a, x) => a + Number(x.services), 0), csvSom(value), csvSom(share)]]);
  }

  private async doctorRows(ctx: Ctx, q: any, r: ReturnType<typeof range>) {
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    let docFilter = '';
    if (ctx.role === 'doctor') { params.push(ctx.doctorId); docFilter = `AND d.id = $${params.length}`; }
    const rows = await this.db.rows(
      `SELECT d.id AS doctor_id, d.display_name AS name, d.specialty,
              coalesce(sum(${LINE_QTY}),0)::int AS services, coalesce(sum(${NET_LINE}),0)::bigint AS value,
              coalesce(sum(round(${NET_LINE} * o.share_percent_snapshot / 100)),0)::bigint AS share
         FROM doctors d
         LEFT JOIN service_orders o ON o.performer_doctor_id = d.id AND o.branch_id = ANY($2) AND o.performed_at >= $3 AND o.performed_at < $4 AND o.status IN ('completed','verified')
         LEFT JOIN invoice_items it ON it.order_id = o.id LEFT JOIN invoices i ON i.id = it.invoice_id
        WHERE d.tenant_id = $1 AND (o.id IS NULL OR i.status <> 'void') ${docFilter}
        GROUP BY d.id ORDER BY value DESC`, params);
    return rows.map((x) => ({ ...x, value: Number(x.value), share: Number(x.share) }));
  }

  private static EXPENSE_ROWS = `SELECT e.id, e.category, e.amount, e.occurred_at, e.note, e.status, e.paid_from, e.shift_id, e.created_by_name, e.void_reason, e.voided_by_name,
              b.name AS branch_name, s.number AS shift_number, s.status AS shift_status FROM expenses e JOIN branches b ON b.id = e.branch_id LEFT JOIN cash_shifts s ON s.id = e.shift_id
        WHERE e.tenant_id = $1 AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4`;

  /** Expenses of a period as CSV (bounded ≤ 1 year); the totals row counts active expenses only. */
  @Roles('manager') @Get('expenses/export.csv')
  async expensesCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const r = range(q);
    const rows = await this.db.rows(`${ReportsController.EXPENSE_ROWS} ORDER BY e.occurred_at`, [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end]);
    const active = rows.filter((x) => x.status === 'active');
    const total = active.reduce((a, x) => a + BigInt(x.amount), 0n);
    sendCsv(res, `meduzai-xarajatlar-${period.from}-${period.to}.csv`, ['Sana (Toshkent)', 'Filial', 'Kategoriya', 'Izoh', 'Manba', 'Smena', 'Kiritgan', 'Holat', 'Bekor sababi', 'Summa (so‘m)'],
      [...rows.map((x) => [csvTime(x.occurred_at), x.branch_name, x.category, x.note, EXPENSE_PAID_FROM_LABEL[x.paid_from] ?? x.paid_from, x.shift_number ? `№${x.shift_number}` : '', x.created_by_name,
          x.status === 'void' ? 'Bekor qilingan' : 'Faol', x.void_reason, csvSom(x.amount)]),
        ['Jami (faol)', '', `${active.length} ta xarajat`, '', '', '', '', '', '', csvSom(total)]]);
  }

  @Roles('manager') @Get('expenses')
  async expenses(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const r = range(q);
    const { page, pageSize, offset } = pageParams(q);
    const P: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(e.amount) FILTER (WHERE e.status = 'active'),0)::bigint AS total FROM expenses e
        WHERE e.tenant_id = $1 AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4`, P))!;
    const rows = await this.db.rows(`${ReportsController.EXPENSE_ROWS} ORDER BY e.occurred_at DESC LIMIT $5 OFFSET $6`, [...P, pageSize, offset]);
    return { data: rows, meta: { from: r.from, to: r.to, page, page_size: pageSize, count: agg.n, total: Number(agg.total) } };
  }

  @Roles('manager') @Get('staff')
  async staff(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.rows(
      `SELECT m.id AS membership_id, u.full_name, u.login, m.role, m.title, m.status, m.branch_ids, m.demo_card, (m.id = $2) AS is_self,
              u.password_hash IS NOT NULL AS has_password, u.must_change_password, u.last_login_at, u.locked_until > now() AS locked,
              (SELECT coalesce(array_agg(ds.service_id), '{}') FROM doctor_services ds WHERE ds.doctor_id = d.id) AS service_ids,
              EXISTS (SELECT 1 FROM schedules sc WHERE sc.doctor_id = d.id) AS has_schedule,
              (SELECT array_agg(b.name ORDER BY b.code) FROM branches b WHERE b.id = ANY(m.branch_ids)) AS branch_names,
              d.id AS doctor_id, d.specialty, d.default_share_percent
         FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN doctors d ON d.membership_id = m.id
        WHERE m.tenant_id = $1 ORDER BY m.status, array_position(ARRAY['manager','doctor','registrar','cashier','lab','storekeeper'], m.role), u.full_name`, [ctx.tenantId, ctx.membershipId]);
    return { data: rows };
  }

  @Roles('manager', 'doctor') @Get('staff/doctors/:id')
  async doctor(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    if (!isUuid(id)) throw notFound('Shifokor');
    if (ctx.role === 'doctor' && ctx.doctorId !== id) throw forbidden();
    const d = await this.db.one(`SELECT d.id, d.display_name, d.specialty, d.phone, d.default_share_percent, d.active, m.branch_ids
       FROM doctors d LEFT JOIN memberships m ON m.id = d.membership_id WHERE d.id = $1 AND d.tenant_id = $2`, [id, ctx.tenantId]);
    if (!d) throw notFound('Shifokor');
    const r = range(q);
    const schedule = await this.db.rows(
      `SELECT s.weekday, s.branch_id, s.room_id, to_char(s.start_time,'HH24:MI') AS start, to_char(s.end_time,'HH24:MI') AS "end", to_char(s.break_start,'HH24:MI') AS break_start,
              to_char(s.break_end,'HH24:MI') AS break_end, b.name AS branch_name, r.name AS room_name
         FROM schedules s JOIN branches b ON b.id = s.branch_id LEFT JOIN rooms r ON r.id = s.room_id WHERE s.doctor_id = $1 ORDER BY (s.weekday + 6) % 7`, [id]);
    const services = await this.db.rows(
      `SELECT o.id, o.service_name, o.category, o.performed_at, ${NET_LINE} AS line_total, o.share_percent_snapshot, round(${NET_LINE} * o.share_percent_snapshot / 100)::bigint AS share,
              p.patient_number, p.last_name, p.first_name
         FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id JOIN patients p ON p.id = o.patient_id
        WHERE o.performer_doctor_id = $1 AND o.performed_at >= $2 AND o.performed_at < $3 AND ${PERFORMED} AND o.branch_id = ANY($4)
        ORDER BY o.performed_at DESC`, [id, r.start, r.end, ctx.branchIds]);
    return { data: { doctor: d, schedule, services: services.map((s) => ({ ...s, line_total: Number(s.line_total), share: Number(s.share) })) }, meta: { from: r.from, to: r.to } };
  }

  @Roles('manager') @Get('audit')
  async audit(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const params: unknown[] = [ctx.tenantId];
    let where = 'tenant_id = $1';
    if (q.action) { params.push(String(q.action) + '%'); where += ` AND action LIKE $${params.length}`; }
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM audit_logs WHERE ${where}`, params))!.n;
    params.push(pageSize, offset);
    const rows = await this.db.rows(`SELECT id, actor_name, actor_role, action, resource_type, resource_id, summary, occurred_at, request_id FROM audit_logs
      WHERE ${where} ORDER BY occurred_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }
}
