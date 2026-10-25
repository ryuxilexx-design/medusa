import { Controller, Get, Query } from '@nestjs/common';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { invalid } from '../core/errors';
import { isDate } from '../core/validate';
import { addDays, dayStart, today, toMinutes, weekday } from '../core/clock';
import { branchScope } from '../core/scope';
import { NET_LINE } from './billing';
import { cameraAttention } from '../cameras/cameras.controller';
import { USABLE_SQL } from './warehouse';

export function range(q: any) {
  const t = today();
  let from = t, to = t;
  if (q.period === '7d') from = addDays(t, -6);
  else if (q.period === '30d') from = addDays(t, -29);
  if (isDate(q.from)) from = q.from;
  if (isDate(q.to)) to = q.to;
  if (from > to) throw invalid({ from: 'Boshlanish sanasi tugash sanasidan keyin bo‘lmasin' });
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 366) throw invalid({ from: 'Oraliq 1 yildan oshmasin' });
  return { from, to, start: dayStart(from), end: dayStart(addDays(to, 1)), days };
}

/**
 * Cash-basis revenue net of refunds for [$3, $4) in tenant $1 / branches $2 — the one formula the dashboard, the
 * manager's AI digest and «ask the numbers» share. Columns: revenue (net), payments (count), refunds (sum).
 */
export const REVENUE_SQL =
  `SELECT (coalesce((SELECT sum(amount) FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4),0)
         - coalesce((SELECT sum(amount) FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4),0))::bigint AS revenue,
          (SELECT count(*) FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4)::int AS payments,
          coalesce((SELECT sum(amount) FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4),0)::bigint AS refunds,
          (SELECT count(*) FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4)::int AS refund_count`;
/** Open debt now (unpaid and partially paid invoices) in tenant $1 / branches $2. */
export const DEBT_SQL = `SELECT coalesce(sum(total - paid_amount),0)::bigint AS debt, count(*)::int AS invoices FROM invoices
        WHERE tenant_id = $1 AND branch_id = ANY($2) AND status IN ('unpaid','partially_paid') AND total > paid_amount`;

/** Every number here is computed from the stored records for the same filter; nothing is cached or hardcoded. */
@Controller()
export class DashboardController {
  constructor(private db: Db) {}

  @Roles('manager') @Get('dashboard')
  async dashboard(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const r = range(q);
    const branches = branchScope(ctx, q.branch_id);
    const P = [ctx.tenantId, branches, r.start, r.end];
    const appt = (await this.db.one(
      `SELECT count(*) FILTER (WHERE status NOT IN ('cancelled','no_show'))::int AS appointments,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled, count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
              count(*) FILTER (WHERE status = 'completed')::int AS completed, count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
              count(*) FILTER (WHERE status IN ('arrived','in_progress'))::int AS in_clinic,
              count(DISTINCT patient_id) FILTER (WHERE status IN ('arrived','in_progress','completed'))::int AS arrived_patients
         FROM appointments WHERE tenant_id = $1 AND branch_id = ANY($2) AND starts_at >= $3 AND starts_at < $4`, P))!;
    // revenue is cash basis and net of refunds made in the same period
    const rev = (await this.db.one(REVENUE_SQL, P))!;
    const debt = (await this.db.one(DEBT_SQL, [ctx.tenantId, branches]))!;
    const daily = await this.db.rows(
      // one indexed range scan per table, grouped by local day (not a subquery per day)
      `WITH pay AS (SELECT (paid_at AT TIME ZONE 'Asia/Tashkent')::date AS day, sum(amount) AS s, count(*) AS n FROM payments
                     WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4 GROUP BY 1),
            ref AS (SELECT (refunded_at AT TIME ZONE 'Asia/Tashkent')::date AS day, sum(amount) AS s FROM refunds
                     WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4 GROUP BY 1)
       SELECT d::date AS date, (coalesce(pay.s,0) - coalesce(ref.s,0))::bigint AS revenue, coalesce(pay.n,0)::int AS payments
         FROM generate_series($3::timestamptz AT TIME ZONE 'Asia/Tashkent', ($4::timestamptz AT TIME ZONE 'Asia/Tashkent') - interval '1 day', interval '1 day') d
         LEFT JOIN pay ON pay.day = d::date LEFT JOIN ref ON ref.day = d::date
        ORDER BY 1`, P);
    const byService = await this.db.rows(
      `SELECT o.service_id, o.service_name, o.category, sum(it.quantity)::int AS count, sum(${NET_LINE})::bigint AS value
         FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
        WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.performed_at >= $3 AND o.performed_at < $4 AND o.status IN ('completed','verified') AND i.status <> 'void'
        GROUP BY 1,2,3 ORDER BY value DESC`, P);
    const doctors = await this.utilization(ctx.tenantId, branches, r.from, r.to, r.start, r.end);
    const recentPayments = await this.db.rows(
      `SELECT pm.id, pm.amount, pm.method, pm.paid_at, pm.receipt_number, pm.cashier_name, i.id AS invoice_id, i.invoice_number, p.last_name, p.first_name, p.patient_number, b.name AS branch_name
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = pm.branch_id
        WHERE pm.tenant_id = $1 AND pm.branch_id = ANY($2) AND pm.paid_at >= $3 AND pm.paid_at < $4 ORDER BY pm.paid_at DESC LIMIT 8`, P);
    const labPending = (await this.db.one(
      `SELECT count(*) FILTER (WHERE status = 'draft_result')::int AS draft, count(*) FILTER (WHERE status IN ('ordered','sample_collected'))::int AS waiting
         FROM service_orders WHERE tenant_id = $1 AND branch_id = ANY($2) AND category = 'lab'`, [ctx.tenantId, branches]))!;
    const lowStock = await this.db.rows(
      `SELECT * FROM (SELECT i.id, i.name, i.unit, i.minimum_qty, ${USABLE_SQL('i')} AS qty
         FROM inventory_items i WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.active) x WHERE qty < minimum_qty ORDER BY name LIMIT 100`, [ctx.tenantId, branches]);
    const cancelledWithPayments = (await this.db.one(
      `SELECT count(DISTINCT a.id)::int AS n FROM appointments a JOIN invoices i ON i.appointment_id = a.id
        WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.status = 'cancelled' AND i.status <> 'void' AND (i.paid_amount > 0 OR i.status = 'unpaid')
          AND a.starts_at >= (SELECT demo_now()) - interval '90 days'`, [ctx.tenantId, branches]))!.n; // recent ones: older ones were dealt with
    const cams = (await cameraAttention(this.db, ctx.tenantId, branches))!;
    return {
      data: {
        range: { from: r.from, to: r.to, branch_ids: branches },
        kpi: { ...appt, revenue: Number(rev.revenue), payments: rev.payments, refunds: Number(rev.refunds), debt: Number(debt.debt), debt_invoices: debt.invoices },
        daily: daily.map((d) => ({ ...d, revenue: Number(d.revenue) })),
        by_service: byService.map((s) => ({ ...s, value: Number(s.value) })),
        doctors,
        recent_payments: recentPayments,
        attention: { unpaid_invoices: debt.invoices, unpaid_sum: Number(debt.debt), lab_draft: labPending.draft, lab_waiting: labPending.waiting, low_stock: lowStock, cancelled_with_invoice: cancelledWithPayments,
          camera_alerts: cams.open_alerts, silent_cameras: cams.silent_cameras },
      },
    };
  }

  /** Occupancy = booked minutes of non-cancelled appointments / working minutes excluding breaks. */
  async utilization(tenantId: string, branches: string[], from: string, to: string, start: Date, end: Date) {
    const docs = await this.db.rows(`SELECT id, display_name, specialty FROM doctors WHERE tenant_id = $1 AND active ORDER BY display_name`, [tenantId]);
    const sch = await this.db.rows(`SELECT doctor_id, branch_id, weekday, to_char(start_time,'HH24:MI') s, to_char(end_time,'HH24:MI') e,
        to_char(break_start,'HH24:MI') bs, to_char(break_end,'HH24:MI') be FROM schedules WHERE tenant_id = $1 AND branch_id = ANY($2)`, [tenantId, branches]);
    const booked = await this.db.rows(
      `SELECT doctor_id, sum(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60)::int AS minutes, count(*)::int AS n,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM appointments WHERE tenant_id = $1 AND branch_id = ANY($2) AND starts_at >= $3 AND starts_at < $4 AND status NOT IN ('cancelled','no_show') GROUP BY 1`,
      [tenantId, branches, start, end]);
    const out = [];
    for (const d of docs) {
      let work = 0;
      for (let day = from; day <= to; day = addDays(day, 1)) {
        const s = sch.find((x) => x.doctor_id === d.id && x.weekday === weekday(day));
        if (s) work += toMinutes(s.e) - toMinutes(s.s) - (s.bs ? toMinutes(s.be) - toMinutes(s.bs) : 0);
      }
      const b = booked.find((x) => x.doctor_id === d.id);
      if (!work && !b) continue;
      out.push({ doctor_id: d.id, name: d.display_name, specialty: d.specialty, appointments: b?.n ?? 0, completed: b?.completed ?? 0,
        booked_minutes: b?.minutes ?? 0, work_minutes: work, utilization: work ? Math.round(((b?.minutes ?? 0) / work) * 1000) / 10 : null });
    }
    return out.sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1));
  }
}
