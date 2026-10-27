// «Ask the numbers» (manager): the model only PICKS one of these whitelisted query templates and fills typed
// parameters — it never writes SQL. The server validates the parameters (period ≤ 1 year and not in the future,
// branch inside the session scope, limit ≤ 20), runs the template's fixed SQL, and the rows (numbers + names of
// doctors/services/items/categories, never a patient) are what the answer is written from.
import { z } from 'zod';
import { translate, type Locale, type MessageKey } from '@meduza/contracts';
import type { Db } from '../core/db';
import type { Ctx } from '../core/context';
import { addDays, dayStart, today } from '../core/clock';
import { isDate, isUuid } from '../core/validate';
import { NET_LINE, PATIENT_DUE } from '../modules/billing';
import { AGE_BUCKETS } from '../modules/invoices.controller';
import { USABLE_SQL } from '../modules/warehouse';
import { som, type Facts, type FactUnit } from './manager-facts';

export type ColType = 'text' | 'date' | 'month' | 'hour' | 'money' | 'count' | 'qty' | 'min';
export type Col = { key: string; type: ColType; sum?: boolean };
export type Result = { columns: Col[]; rows: Record<string, string | number | null>[] };
export type AskParams = { from?: string; to?: string; group_by?: string; limit?: number; kind?: string; days?: number; branch_id?: string | null };
type Run = { tenantId: string; branches: string[]; from: string; to: string; start: Date; end: Date; group: string; limit: number; kind: string; days: number; locale: Locale };
type Template = { period: boolean; groups?: string[]; kinds?: string[]; limit?: boolean; days?: boolean; run: (db: Db, r: Run) => Promise<Result> };

const LOCAL_DAY = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD')`;
const LOCAL_MONTH = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')`;
const num = (rows: any[], cols: Col[]) => rows.map((r) => Object.fromEntries(cols.map((c) => [c.key, c.type === 'text' || c.type === 'date' || c.type === 'month' || c.type === 'hour' ? r[c.key] ?? null : r[c.key] == null ? null : Number(r[c.key])])));
const tr = (L: Locale, key: string) => translate(L, key as MessageKey);

/** Cash-basis revenue net of refunds, grouped by a key over payments and refunds (same formula as the dashboard). */
async function cashRevenue(db: Db, r: Run, payKey: string, refKey: string) {
  return db.rows(
    `WITH pay AS (SELECT ${payKey} AS k, sum(amount) AS s, count(*) AS n FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4 GROUP BY 1),
          ref AS (SELECT ${refKey} AS k, sum(amount) AS s FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4 GROUP BY 1)
     SELECT coalesce(pay.k, ref.k) AS k, (coalesce(pay.s,0) - coalesce(ref.s,0))::bigint AS revenue, coalesce(pay.n,0)::int AS payments
       FROM pay FULL JOIN ref ON ref.k = pay.k ORDER BY 1`, [r.tenantId, r.branches, r.start, r.end]);
}

export const TEMPLATES: Record<string, Template> = {
  revenue: {
    period: true, groups: ['day', 'month', 'branch', 'method', 'doctor', 'service'], limit: true,
    async run(db, r) {
      if (r.group === 'doctor' || r.group === 'service') {
        const by = r.group === 'doctor' ? 'd.display_name' : 'o.service_name';
        const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'services', type: 'count', sum: true }, { key: 'revenue', type: 'money', sum: true }];
        const rows = await db.rows(
          `SELECT ${by} AS label, sum(it.quantity)::int AS services, sum(${NET_LINE})::bigint AS revenue
             FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id ${r.group === 'doctor' ? 'JOIN doctors d ON d.id = o.performer_doctor_id' : ''}
            WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.performed_at >= $3 AND o.performed_at < $4 AND o.status IN ('completed','verified') AND i.status <> 'void'
            GROUP BY 1 ORDER BY revenue DESC, 1 LIMIT $5`, [r.tenantId, r.branches, r.start, r.end, r.limit]);
        return { columns: cols, rows: num(rows, cols) };
      }
      if (r.group === 'day') {
        const cols: Col[] = [{ key: 'date', type: 'date' }, { key: 'payments', type: 'count', sum: true }, { key: 'revenue', type: 'money', sum: true }];
        const rows = await db.rows(
          `WITH pay AS (SELECT ${LOCAL_DAY('paid_at')} AS day, sum(amount) AS s, count(*) AS n FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4 GROUP BY 1),
                ref AS (SELECT ${LOCAL_DAY('refunded_at')} AS day, sum(amount) AS s FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4 GROUP BY 1)
           SELECT to_char(d, 'YYYY-MM-DD') AS date, (coalesce(pay.s,0) - coalesce(ref.s,0))::bigint AS revenue, coalesce(pay.n,0)::int AS payments
             FROM generate_series($5::date, $6::date, interval '1 day') d
             LEFT JOIN pay ON pay.day = to_char(d, 'YYYY-MM-DD') LEFT JOIN ref ON ref.day = to_char(d, 'YYYY-MM-DD') ORDER BY 1`,
          [r.tenantId, r.branches, r.start, r.end, r.from, r.to]);
        return { columns: cols, rows: num(rows, cols) };
      }
      if (r.group === 'month') {
        const cols: Col[] = [{ key: 'month', type: 'month' }, { key: 'payments', type: 'count', sum: true }, { key: 'revenue', type: 'money', sum: true }];
        const rows = (await cashRevenue(db, r, LOCAL_MONTH('paid_at'), LOCAL_MONTH('refunded_at'))).map((x) => ({ ...x, month: x.k }));
        return { columns: cols, rows: num(rows, cols) };
      }
      const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'payments', type: 'count', sum: true }, { key: 'revenue', type: 'money', sum: true }];
      if (r.group === 'branch') {
        const rows = await cashRevenue(db, r, 'branch_id::text', 'branch_id::text');
        const names = new Map((await db.rows(`SELECT id::text, name FROM branches WHERE tenant_id = $1 AND id = ANY($2)`, [r.tenantId, r.branches])).map((b) => [b.id, b.name]));
        return { columns: cols, rows: num(rows.map((x) => ({ ...x, label: names.get(x.k) ?? '—' })), cols) };
      }
      const rows = await cashRevenue(db, r, 'method', 'method');
      return { columns: cols, rows: num(rows.map((x) => ({ ...x, label: tr(r.locale, `payment.${x.k}`) })), cols) };
    },
  },
  visits: {
    period: true, groups: ['doctor', 'day'], limit: true,
    async run(db, r) {
      const byDoctor = r.group === 'doctor';
      const cols: Col[] = [{ key: byDoctor ? 'label' : 'date', type: byDoctor ? 'text' : 'date' }, { key: 'booked', type: 'count', sum: true }, { key: 'completed', type: 'count', sum: true },
        { key: 'no_show', type: 'count', sum: true }, { key: 'cancelled', type: 'count', sum: true }];
      const rows = await db.rows(
        `SELECT ${byDoctor ? 'd.display_name AS label' : `${LOCAL_DAY('a.starts_at')} AS date`},
                count(*) FILTER (WHERE a.status NOT IN ('cancelled','no_show'))::int AS booked, count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
                count(*) FILTER (WHERE a.status = 'no_show')::int AS no_show, count(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled
           FROM appointments a JOIN doctors d ON d.id = a.doctor_id
          WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.starts_at >= $3 AND a.starts_at < $4
          GROUP BY 1 ORDER BY ${byDoctor ? 'no_show DESC, booked DESC, 1' : '1'} LIMIT $5`, [r.tenantId, r.branches, r.start, r.end, byDoctor ? r.limit : 31]);
      return { columns: cols, rows: num(rows, cols) };
    },
  },
  top_services: {
    period: true, limit: true,
    async run(db, r) {
      const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'count', type: 'count', sum: true }, { key: 'revenue', type: 'money', sum: true }];
      const rows = await db.rows(
        `SELECT o.service_name AS label, sum(it.quantity)::int AS count, sum(${NET_LINE})::bigint AS revenue
           FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
          WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.performed_at >= $3 AND o.performed_at < $4 AND o.status IN ('completed','verified') AND i.status <> 'void'
          GROUP BY 1 ORDER BY revenue DESC, 1 LIMIT $5`, [r.tenantId, r.branches, r.start, r.end, r.limit]);
      return { columns: cols, rows: num(rows, cols) };
    },
  },
  debts_ageing: {
    period: false,
    async run(db, r) {
      const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'invoices', type: 'count', sum: true }, { key: 'debt', type: 'money', sum: true }];
      const a = (await db.one(
        `SELECT ${Object.entries(AGE_BUCKETS).map(([, w], i) => `count(*) FILTER (WHERE ${w})::int AS n${i}, coalesce(sum(${PATIENT_DUE()}) FILTER (WHERE ${w}),0)::bigint AS s${i}`).join(', ')}
           FROM invoices i WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.status IN ('unpaid','partially_paid') AND ${PATIENT_DUE()} > 0`, [r.tenantId, r.branches]))!;
      const rows = Object.keys(AGE_BUCKETS).map((b, i) => ({ label: tr(r.locale, `mgrai.age.${b}`), invoices: a[`n${i}`], debt: a[`s${i}`] }));
      return { columns: cols, rows: num(rows, cols) };
    },
  },
  refunds: {
    period: true, groups: ['reason', 'method', 'day'],
    async run(db, r) {
      const key = r.group === 'day' ? LOCAL_DAY('refunded_at') : r.group === 'method' ? 'method' : 'reason_code';
      const first: Col = r.group === 'day' ? { key: 'date', type: 'date' } : { key: 'label', type: 'text' };
      const cols: Col[] = [first, { key: 'count', type: 'count', sum: true }, { key: 'amount', type: 'money', sum: true }];
      const rows = await db.rows(
        `SELECT ${key} AS k, count(*)::int AS count, sum(amount)::bigint AS amount FROM refunds
          WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4 GROUP BY 1 ORDER BY ${r.group === 'day' ? '1' : 'amount DESC'} LIMIT 31`,
        [r.tenantId, r.branches, r.start, r.end]);
      const label = (k: string) => (r.group === 'method' ? tr(r.locale, `payment.${k}`) : tr(r.locale, `cash.refundReason.${k}`));
      return { columns: cols, rows: num(rows.map((x) => (r.group === 'day' ? { ...x, date: x.k } : { ...x, label: label(x.k) })), cols) };
    },
  },
  expenses: {
    period: true, limit: true,
    async run(db, r) {
      const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'count', type: 'count', sum: true }, { key: 'amount', type: 'money', sum: true }];
      const rows = await db.rows(
        `SELECT category AS label, count(*)::int AS count, sum(amount)::bigint AS amount FROM expenses
          WHERE tenant_id = $1 AND branch_id = ANY($2) AND occurred_at >= $3 AND occurred_at < $4 AND status = 'active'
          GROUP BY 1 ORDER BY amount DESC, 1 LIMIT $5`, [r.tenantId, r.branches, r.start, r.end, r.limit]);
      return { columns: cols, rows: num(rows, cols) };
    },
  },
  warehouse_consumption: {
    period: true, groups: ['item', 'doctor', 'icd_group'], limit: true,
    async run(db, r) {
      // issues minus returns, voided rows excluded; a visit's ICD group is the first code's category (codes only)
      const by = r.group === 'item' ? 'it.name' : r.group === 'doctor' ? `coalesce(m.receiver_name, '—')` : `coalesce(left(m.icd_codes[1], 3), '—')`;
      const cols: Col[] = r.group === 'item'
        ? [{ key: 'label', type: 'text' }, { key: 'qty', type: 'qty' }, { key: 'unit', type: 'text' }, { key: 'value', type: 'money', sum: true }]
        : [{ key: 'label', type: 'text' }, { key: 'issues', type: 'count', sum: true }, { key: 'value', type: 'money', sum: true }];
      const rows = await db.rows(
        `SELECT ${by} AS label, ${r.group === 'item' ? 'min(it.unit) AS unit,' : ''}
                sum(CASE WHEN m.kind = 'issue' THEN m.quantity ELSE -m.quantity END) AS qty,
                count(*) FILTER (WHERE m.kind = 'issue')::int AS issues,
                sum(CASE WHEN m.kind = 'issue' THEN m.value ELSE -m.value END)::bigint AS value
           FROM inventory_movements m JOIN inventory_items it ON it.id = m.item_id
          WHERE m.tenant_id = $1 AND m.branch_id = ANY($2) AND m.occurred_at >= $3 AND m.occurred_at < $4 AND m.kind IN ('issue','return') AND m.voided_at IS NULL
          GROUP BY 1 ORDER BY value DESC, qty DESC, 1 LIMIT $5`, [r.tenantId, r.branches, r.start, r.end, r.limit]);
      return { columns: cols, rows: num(rows, cols) };
    },
  },
  stock: {
    period: false, kinds: ['low', 'expiring'], days: true, limit: true,
    async run(db, r) {
      if (r.kind === 'low') {
        const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'qty', type: 'qty' }, { key: 'minimum', type: 'qty' }, { key: 'unit', type: 'text' }];
        const rows = await db.rows(
          `SELECT * FROM (SELECT i.name AS label, i.unit, i.minimum_qty AS minimum, ${USABLE_SQL('i')} AS qty FROM inventory_items i
             WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.active) x WHERE qty < minimum ORDER BY label LIMIT $3`, [r.tenantId, r.branches, r.limit]);
        return { columns: cols, rows: num(rows, cols) };
      }
      const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'batch', type: 'text' }, { key: 'expiry', type: 'date' }, { key: 'days_left', type: 'count' }, { key: 'qty', type: 'qty' }, { key: 'unit', type: 'text' }];
      const t = today();
      const rows = await db.rows(
        `SELECT i.name AS label, coalesce(b.batch_no, '—') AS batch, to_char(b.expiry_date, 'YYYY-MM-DD') AS expiry, (b.expiry_date - $3::date)::int AS days_left, b.qty, i.unit
           FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
          WHERE b.tenant_id = $1 AND i.branch_id = ANY($2) AND b.qty > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= $3::date + $4::int
          ORDER BY b.expiry_date, i.name LIMIT $5`, [r.tenantId, r.branches, t, r.days, r.limit]);
      return { columns: cols, rows: num(rows, cols) };
    },
  },
  staff_lateness: {
    period: true, limit: true,
    async run(db, r) {
      // first sighting by an attendance camera vs the doctor's schedule start; ≤ 5 minutes is on time (same as /cameras/attendance)
      const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'days_seen', type: 'count' }, { key: 'days_late', type: 'count', sum: true }, { key: 'avg_late_min', type: 'min' }, { key: 'max_late_min', type: 'min' }];
      const rows = await db.rows(
        `WITH seen AS (
           SELECT fc.membership_id, (e.occurred_at AT TIME ZONE 'Asia/Tashkent')::date AS day, min(e.occurred_at) AS first_at
             FROM camera_events e JOIN face_codes fc ON fc.id = e.face_code_id AND fc.subject_type = 'staff'
            WHERE e.tenant_id = $1 AND e.kind = 'face_match' AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4 GROUP BY 1, 2),
         plan AS (SELECT doctor_id, weekday, min(start_time) AS start_time FROM schedules WHERE tenant_id = $1 AND branch_id = ANY($2) GROUP BY 1, 2),
         late AS (
           SELECT d.display_name AS label, round(EXTRACT(EPOCH FROM (s.first_at - ((s.day + p.start_time) AT TIME ZONE 'Asia/Tashkent'))) / 60)::int AS m
             FROM seen s JOIN doctors d ON d.membership_id = s.membership_id AND d.tenant_id = $1
             JOIN plan p ON p.doctor_id = d.id AND p.weekday = EXTRACT(DOW FROM s.day)::int)
         SELECT label, count(*)::int AS days_seen, count(*) FILTER (WHERE m > 5)::int AS days_late,
                coalesce(round(avg(m) FILTER (WHERE m > 5)), 0)::int AS avg_late_min, greatest(coalesce(max(m), 0), 0)::int AS max_late_min
           FROM late GROUP BY label ORDER BY days_late DESC, avg_late_min DESC, label LIMIT $5`, [r.tenantId, r.branches, r.start, r.end, r.limit]);
      return { columns: cols, rows: num(rows, cols) };
    },
  },
  patient_flow: {
    period: true,
    async run(db, r) {
      const cols: Col[] = [{ key: 'hour', type: 'hour' }, { key: 'visits', type: 'count', sum: true }];
      const rows = await db.rows(
        `SELECT to_char(date_trunc('hour', a.starts_at AT TIME ZONE 'Asia/Tashkent'), 'HH24:00') AS hour, count(*)::int AS visits
           FROM appointments a WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.starts_at >= $3 AND a.starts_at < $4 AND a.status IN ('arrived','in_progress','completed')
          GROUP BY 1 ORDER BY 1`, [r.tenantId, r.branches, r.start, r.end]);
      return { columns: cols, rows: num(rows, cols) };
    },
  },
  new_vs_returning: {
    period: true,
    async run(db, r) {
      const cols: Col[] = [{ key: 'label', type: 'text' }, { key: 'patients', type: 'count', sum: true }];
      const a = (await db.one(
        `WITH v AS (SELECT DISTINCT a.patient_id FROM appointments a
                     WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.starts_at >= $3 AND a.starts_at < $4 AND a.status IN ('arrived','in_progress','completed')),
              f AS (SELECT v.patient_id, EXISTS (SELECT 1 FROM appointments b WHERE b.patient_id = v.patient_id AND b.starts_at < $3 AND b.status IN ('arrived','in_progress','completed')) AS seen FROM v)
         SELECT count(*) FILTER (WHERE NOT seen)::int AS new, count(*) FILTER (WHERE seen)::int AS returning FROM f`, [r.tenantId, r.branches, r.start, r.end]))!;
      return { columns: cols, rows: num([{ label: tr(r.locale, 'mgrai.row.new'), patients: a.new }, { label: tr(r.locale, 'mgrai.row.returning'), patients: a.returning }], cols) };
    },
  },
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES);

/** What the model's plan may contain; the server then checks every value against the template. */
export const planZ = z.object({
  template: z.string().max(64),
  params: z.object({
    from: z.string().max(20).optional().nullable(), to: z.string().max(20).optional().nullable(), group_by: z.string().max(32).optional().nullable(),
    limit: z.number().optional().nullable(), kind: z.string().max(32).optional().nullable(), days: z.number().optional().nullable(), branch_id: z.string().max(64).optional().nullable(),
  }).passthrough().optional().nullable(),
});
export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    template: { type: 'string', enum: [...TEMPLATE_IDS, 'unsupported'] },
    params: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, group_by: { type: 'string' },
        limit: { type: 'integer' }, kind: { type: 'string' }, days: { type: 'integer' }, branch_id: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  required: ['template', 'params'],
  additionalProperties: false,
};

export type Checked = { ok: true; id: string; run: Omit<Run, 'tenantId' | 'locale'>; params: AskParams } | { ok: false; reason: 'template' | 'params' };
const MAX_DAYS = 366;
/**
 * Validates a template id and its parameters against the whitelist. Missing period → the last 30 days (to today);
 * a period in the future, longer than a year or reversed, an unknown grouping, a limit outside 1–20 or a branch
 * outside the session scope → refused (never clamped silently). A parameter the template does not use is ignored.
 */
export function checkPlan(ctx: Ctx, id: string, raw: AskParams | null | undefined, defaultBranches: string[]): Checked {
  if (!Object.hasOwn(TEMPLATES, id)) return { ok: false, reason: 'template' };
  const tpl = TEMPLATES[id];
  const p = raw ?? {};
  const known = new Set(['from', 'to', 'group_by', 'limit', 'kind', 'days', 'branch_id']);
  if (Object.keys(p).some((k) => !known.has(k))) return { ok: false, reason: 'params' };
  const t = today();
  const from = p.from ?? (p.to ? p.to : addDays(t, -29)), to = p.to ?? t;
  if (tpl.period) {
    if (!isDate(from) || !isDate(to) || from > to || to > t) return { ok: false, reason: 'params' };
    if (Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 > MAX_DAYS) return { ok: false, reason: 'params' };
  }
  const group = p.group_by ?? tpl.groups?.[0] ?? '';
  if (tpl.groups && !tpl.groups.includes(group)) return { ok: false, reason: 'params' };
  // a day-by-day table is at most a month long
  if (group === 'day' && Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 > 31) return { ok: false, reason: 'params' };
  const limit = p.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return { ok: false, reason: 'params' };
  const kind = p.kind ?? tpl.kinds?.[0] ?? '';
  if (tpl.kinds && !tpl.kinds.includes(kind)) return { ok: false, reason: 'params' };
  const days = p.days ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 180) return { ok: false, reason: 'params' };
  let branches = defaultBranches;
  if (p.branch_id != null) {
    if (!isUuid(p.branch_id) || !ctx.branchIds.includes(p.branch_id)) return { ok: false, reason: 'params' };
    branches = [p.branch_id];
  }
  const params: AskParams = { ...(tpl.period ? { from, to } : {}), ...(tpl.groups ? { group_by: group } : {}), ...(tpl.limit ? { limit } : {}),
    ...(tpl.kinds ? { kind } : {}), ...(tpl.days && kind === 'expiring' ? { days } : {}), ...(p.branch_id ? { branch_id: p.branch_id } : {}) };
  return { ok: true, id, params, run: { branches, from, to, start: dayStart(from), end: dayStart(addDays(to, 1)), group, limit, kind, days } };
}

export async function runTemplate(db: Db, ctx: Ctx, c: Extract<Checked, { ok: true }>): Promise<Result> {
  const res = await TEMPLATES[c.id].run(db, { ...c.run, tenantId: ctx.tenantId, locale: ctx.locale });
  return { columns: res.columns, rows: res.rows.slice(0, 31) };
}

const UNIT: Record<ColType, FactUnit | null> = { money: 'som', count: 'count', qty: 'qty', min: 'min', text: null, date: null, month: null, hour: null };
/**
 * The rows as facts for the answer: `r1.revenue` (money in whole so‘m), labelled with the row's name/date; summable
 * columns also get `total.<col>` (integer sums done here, never by the model).
 */
export function rowFacts(res: Result): Facts {
  const f: Facts = {};
  const labelCol = res.columns.find((c) => c.type === 'text' || c.type === 'date' || c.type === 'month' || c.type === 'hour');
  res.rows.forEach((row, i) => {
    const label = labelCol ? String(row[labelCol.key] ?? '') : undefined;
    for (const c of res.columns) {
      const unit = UNIT[c.type];
      if (!unit || row[c.key] == null) continue;
      const v = Number(row[c.key]);
      f[`r${i + 1}.${c.key}`] = { value: unit === 'som' ? som(v) : v, unit, ...(label ? { label } : {}) };
    }
  });
  for (const c of res.columns) {
    if (!c.sum) continue;
    const total = res.rows.reduce((a, r) => a + BigInt(Math.round(Number(r[c.key] ?? 0) * (c.type === 'qty' ? 100 : 1))), 0n);
    f[`total.${c.key}`] = { value: c.type === 'money' ? som(total.toString()) : Number(total), unit: UNIT[c.type]! };
  }
  f['rows.count'] = { value: res.rows.length, unit: 'count' };
  return f;
}

/** The system prompt's list of templates (ids, what they answer, their parameters). */
export const TEMPLATE_HELP = `revenue — tushum (naqd hisob, qaytarishlar ayirilgan). group_by: day (≤31 kun) | month | branch | method (to‘lov usuli) | doctor | service. limit (doctor/service).
visits — qabullar: rejalashtirilgan, yakunlangan, kelmagan (no_show), bekor. group_by: doctor | day.
top_services — eng ko‘p tushum bergan xizmatlar. limit.
debts_ageing — ochiq qarzlar muddati bo‘yicha (0–7, 8–30, 31+ kun). Davr yo‘q.
refunds — qaytarishlar. group_by: reason | method | day.
expenses — xarajatlar kategoriya bo‘yicha. limit.
warehouse_consumption — ombordan sarf (chiqim − qaytarish). group_by: item | doctor (kim oldi) | icd_group (MKB-10 guruhi, faqat kod). limit.
stock — ombor qoldig‘i. kind: low (minimumdan kam) | expiring (days kun ichida muddati tugaydi, 1–180). limit. Davr yo‘q.
staff_lateness — kamera bo‘yicha shifokorlar kechikishi (jadvalga nisbatan). limit.
patient_flow — soatlar bo‘yicha bemor oqimi (kelgan qabullar).
new_vs_returning — davrda kelgan yangi va qayta kelgan bemorlar soni.`;
