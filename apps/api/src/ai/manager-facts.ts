// The manager's AI is non-clinical: the model never sees a patient name or clinical text. It receives a fact sheet —
// numbers computed here by SQL (the same formulas as the dashboard and reports) plus the names of doctors, services
// and stock items — and may only rephrase it. Every number in its text is checked against the facts it cites
// (`checkItems`); a bullet whose numbers do not match is dropped. The model never does arithmetic: differences and
// percentages are computed here.
import { formatSom, translate, type Locale, type MessageKey } from '@meduza/contracts';
import type { Db } from '../core/db';
import { addDays, dayStart, today } from '../core/clock';
import { DEBT_SQL, REVENUE_SQL } from '../modules/dashboard.controller';
import { NET_LINE } from '../modules/billing';
import { USABLE_SQL } from '../modules/warehouse';
import { cameraAttention } from '../cameras/cameras.controller';

export type FactUnit = 'som' | 'count' | 'pct' | 'qty' | 'min';
/** One number. Money is whole so‘m (rounded from tiyin); `label` names a doctor/service/item/category, never a patient. */
export type Fact = { value: number; unit: FactUnit; label?: string; period?: 'day' | 'compare' | 'now' };
export type Facts = Record<string, Fact>;
export type FactSheet = { day: string; compare_day: string; branch_ids: string[]; facts: Facts };
export type Item = { text: string; fact_keys: string[] };
export type Alert = Item & { severity: 'info' | 'warning' | 'critical' };
export type Digest = { bullets: Item[]; alerts: Alert[] };

/** tiyin → whole so‘m for the model (the UI formats tiyin itself). */
export const som = (tiyin: number | string | bigint) => Math.round(Number(tiyin) / 100);
const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

async function dayMetrics(db: Db, tenantId: string, branches: string[], day: string) {
  const P = [tenantId, branches, dayStart(day), dayStart(addDays(day, 1))];
  const [rev, methods, visits, newPatients, services, doctors] = await Promise.all([
    db.one(REVENUE_SQL, P),
    db.rows(`SELECT method, coalesce(sum(amount),0)::bigint AS s FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4 GROUP BY 1`, P),
    db.one(
      `SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed, count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled, count(*) FILTER (WHERE status NOT IN ('cancelled','no_show'))::int AS booked
         FROM appointments WHERE tenant_id = $1 AND branch_id = ANY($2) AND starts_at >= $3 AND starts_at < $4`, P),
    // a new card counts for a branch when the patient has a visit there (patients themselves belong to the clinic)
    db.one(
      `SELECT count(*)::int AS n FROM patients p WHERE p.tenant_id = $1 AND p.created_at >= $3 AND p.created_at < $4
          AND EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.branch_id = ANY($2))`, P),
    db.rows(
      `SELECT o.service_name, sum(it.quantity)::int AS count, sum(${NET_LINE})::bigint AS value
         FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
        WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.performed_at >= $3 AND o.performed_at < $4 AND o.status IN ('completed','verified') AND i.status <> 'void'
        GROUP BY 1 ORDER BY value DESC, o.service_name LIMIT 5`, P),
    db.rows(
      `SELECT d.display_name AS name, count(*) FILTER (WHERE a.status = 'completed')::int AS completed, count(*)::int AS booked
         FROM appointments a JOIN doctors d ON d.id = a.doctor_id
        WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.starts_at >= $3 AND a.starts_at < $4 AND a.status NOT IN ('cancelled','no_show')
        GROUP BY d.id, d.display_name ORDER BY completed DESC, booked DESC, d.display_name LIMIT 8`, P),
  ]);
  return { rev: rev!, methods, visits: visits!, newPatients: newPatients!.n as number, services, doctors };
}

/** The digest's fact sheet for one Tashkent day and branch scope; compared with the same weekday a week earlier. */
export async function buildFacts(db: Db, tenantId: string, branches: string[], day: string): Promise<FactSheet> {
  const compareDay = addDays(day, -7);
  const now = today();
  const [cur, prev] = await Promise.all([dayMetrics(db, tenantId, branches, day), dayMetrics(db, tenantId, branches, compareDay)]);
  const P = [tenantId, branches];
  const dayP = [tenantId, branches, dayStart(day), dayStart(addDays(day, 1))];
  const [debt, stock, wh, lab, cancelledOpen, delivery, fiscal, cams] = await Promise.all([
    db.one(DEBT_SQL, P),
    db.one(
      `SELECT (SELECT count(*)::int FROM inventory_items i WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.active AND ${USABLE_SQL('i')} < i.minimum_qty) AS low,
              (SELECT count(*)::int FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
                WHERE b.tenant_id = $1 AND i.branch_id = ANY($2) AND b.qty > 0 AND b.expiry_date >= $3::date AND b.expiry_date <= $3::date + 30) AS expiring,
              (SELECT count(*)::int FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
                WHERE b.tenant_id = $1 AND i.branch_id = ANY($2) AND b.qty > 0 AND b.expiry_date < $3::date) AS expired`, [...P, now]),
    db.one(
      `SELECT (SELECT count(*)::int FROM inventory_requests WHERE tenant_id = $1 AND branch_id = ANY($2) AND status IN ('submitted','partially_issued')) AS requests,
              (SELECT count(*)::int FROM inventory_requests WHERE tenant_id = $1 AND branch_id = ANY($2) AND status = 'submitted' AND needs_approval AND approved_at IS NULL) AS approvals,
              (SELECT count(*)::int FROM inventory_writeoffs WHERE tenant_id = $1 AND branch_id = ANY($2) AND status = 'pending') AS writeoffs`, P),
    db.one(`SELECT count(*)::int AS n FROM service_orders WHERE tenant_id = $1 AND branch_id = ANY($2) AND category = 'lab' AND status = 'draft_result'`, P),
    db.one(
      `SELECT count(DISTINCT a.id)::int AS n FROM appointments a JOIN invoices i ON i.appointment_id = a.id
        WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.status = 'cancelled' AND i.status <> 'void' AND (i.paid_amount > 0 OR i.status = 'unpaid')
          AND a.starts_at >= (SELECT demo_now()) - interval '90 days'`, P),
    // notices have no branch of their own: a notice about an appointment counts for that appointment's branch
    db.one(
      `SELECT (SELECT count(*)::int FROM notifications n LEFT JOIN appointments a ON a.id = n.appointment_id
                WHERE n.tenant_id = $1 AND n.status = 'failed' AND n.created_at >= $3 AND n.created_at < $4 AND (a.id IS NULL OR a.branch_id = ANY($2))) AS telegram,
              (SELECT count(*)::int FROM sms_messages s LEFT JOIN notifications n ON n.id = s.notification_id LEFT JOIN appointments a ON a.id = n.appointment_id
                WHERE s.tenant_id = $1 AND s.status IN ('failed','undelivered') AND s.created_at >= $3 AND s.created_at < $4 AND (a.id IS NULL OR a.branch_id = ANY($2))) AS sms`, dayP),
    db.one(
      `SELECT count(*)::int AS n FROM fiscal_receipts f LEFT JOIN payments p ON p.id = f.payment_id LEFT JOIN refunds r ON r.id = f.refund_id
        WHERE f.tenant_id = $1 AND f.status IN ('pending','failed') AND coalesce(p.branch_id, r.branch_id) = ANY($2)`, P),
    cameraAttention(db, tenantId, branches),
  ]);

  const f: Facts = {};
  const put = (key: string, value: number, unit: FactUnit, period: Fact['period'], label?: string) => { f[key] = { value, unit, period, ...(label ? { label } : {}) }; };
  const revNet = som(cur.rev.revenue), revPrev = som(prev.rev.revenue);
  put('revenue.net', revNet, 'som', 'day');
  put('revenue.net_last_week', revPrev, 'som', 'compare');
  put('revenue.change', revNet - revPrev, 'som', 'compare');
  const pct = pctChange(Number(cur.rev.revenue), Number(prev.rev.revenue));
  if (pct !== null) put('revenue.change_pct', pct, 'pct', 'compare');
  put('payments.count', cur.rev.payments, 'count', 'day');
  for (const m of ['cash', 'card', 'transfer']) put(`payments.${m}`, som(cur.methods.find((x) => x.method === m)?.s ?? 0), 'som', 'day');
  put('refunds.total', som(cur.rev.refunds), 'som', 'day');
  put('refunds.count', cur.rev.refund_count, 'count', 'day');
  put('visits.completed', cur.visits.completed, 'count', 'day');
  put('visits.completed_last_week', prev.visits.completed, 'count', 'compare');
  put('visits.no_show', cur.visits.no_show, 'count', 'day');
  put('visits.no_show_last_week', prev.visits.no_show, 'count', 'compare');
  put('visits.cancelled', cur.visits.cancelled, 'count', 'day');
  put('visits.booked', cur.visits.booked, 'count', 'day');
  put('patients.new', cur.newPatients, 'count', 'day');
  put('patients.new_last_week', prev.newPatients, 'count', 'compare');
  cur.services.forEach((s, i) => {
    put(`service.${i + 1}.revenue`, som(s.value), 'som', 'day', s.service_name);
    put(`service.${i + 1}.count`, s.count, 'count', 'day', s.service_name);
  });
  cur.doctors.forEach((d, i) => {
    put(`doctor.${i + 1}.completed`, d.completed, 'count', 'day', d.name);
    put(`doctor.${i + 1}.booked`, d.booked, 'count', 'day', d.name);
  });
  put('debts.total', som(debt!.debt), 'som', 'now');
  put('debts.invoices', debt!.invoices, 'count', 'now');
  put('stock.low_items', stock!.low, 'count', 'now');
  put('stock.expiring_30d', stock!.expiring, 'count', 'now');
  put('stock.expired_in_stock', stock!.expired, 'count', 'now');
  put('warehouse.requests_pending', wh!.requests, 'count', 'now');
  put('warehouse.approvals_pending', wh!.approvals, 'count', 'now');
  put('warehouse.writeoffs_pending', wh!.writeoffs, 'count', 'now');
  put('lab.unverified', lab!.n, 'count', 'now');
  put('invoices.cancelled_with_invoice', cancelledOpen!.n, 'count', 'now');
  put('camera.alerts_open', cams!.open_alerts, 'count', 'now');
  put('camera.silent', cams!.silent_cameras, 'count', 'now');
  put('delivery.telegram_failed', delivery!.telegram, 'count', 'day');
  put('delivery.sms_failed', delivery!.sms, 'count', 'day');
  put('fiscal.missing', fiscal!.n, 'count', 'now');
  return { day, compare_day: compareDay, branch_ids: branches, facts: f };
}

// ---------- number check ----------

const MULT: [RegExp, number][] = [[/^(mlrd|млрд)/i, 1e9], [/^(mln|млн|million)/i, 1e6], [/^(ming|минг|тыс|k\b)/i, 1e3]];
/**
 * The numbers a sentence states, with their precision: «1 250 000», «1 250 000,5», «1,3 mln», «12%», «−5».
 * Thousands groups are separated by a space (regular, no-break or narrow); «1,250» (comma + exactly 3 digits, no
 * multiplier) is read as a thousands group too.
 */
export function numbersIn(text: string): { value: number; decimals: number; mult: number }[] {
  const out: { value: number; decimals: number; mult: number }[] = [];
  const re = /(\d{1,3}(?:[   ]\d{3})+|\d+)(?:([.,])(\d+))?\s*([^\s\d.,;:!?)]*)/gu;
  for (const m of text.matchAll(re)) {
    const whole = m[1].replace(/[   ]/g, '');
    const word = m[4] ?? '';
    const mult = MULT.find(([r]) => r.test(word))?.[1] ?? 1;
    let frac = m[3] ?? '';
    let int = whole;
    if (frac && m[2] === ',' && frac.length === 3 && mult === 1) { int = whole + frac; frac = ''; }
    out.push({ value: Number(frac ? `${int}.${frac}` : int), decimals: frac.length, mult });
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * True when every number in `text` equals the value of one of the cited facts (sign ignored: «12% kam» states −12),
 * at the precision written («1,3 mln» matches 1 254 000). Digits inside a cited fact's label (a service «UZI 3D»)
 * are not numbers the model stated.
 */
export function numbersMatch(text: string, cited: Fact[]): boolean {
  let t = text;
  for (const f of cited) if (f.label) t = t.replace(new RegExp(esc(f.label), 'g'), ' ');
  const values = cited.map((f) => Math.abs(f.value));
  return numbersIn(t).every((n) => values.some((v) => {
    if (n.mult === 1 && n.decimals === 0) return v === n.value;
    const scaled = v / n.mult, k = 10 ** n.decimals;
    return Math.round(scaled * k) / k === n.value || Math.trunc(scaled * k) / k === n.value;
  }));
}

/** Keeps the model's items whose cited keys all exist and whose numbers all match; returns how many were dropped. */
export function checkItems<T extends Item>(items: T[], facts: Facts, max: number): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let dropped = 0;
  for (const it of items) {
    const keys = [...new Set(it.fact_keys)];
    const ok = keys.length > 0 && keys.every((k) => Object.hasOwn(facts, k)) && it.text.trim().length > 0 && numbersMatch(it.text, keys.map((k) => facts[k]));
    if (ok && kept.length < max) kept.push({ ...it, text: it.text.trim(), fact_keys: keys });
    else dropped++;
  }
  return { kept, dropped };
}

// ---------- the digest without a model ----------

/** A deterministic digest from the same facts (AI off, sample mode, or a model answer that failed the check). */
export function templateDigest(locale: Locale, sheet: FactSheet): Digest {
  const f = sheet.facts, L = locale;
  const v = (k: string) => f[k]?.value ?? 0;
  const money = (k: string) => formatSom(v(k) * 100, true, L);
  const t = (key: MessageKey, p?: Record<string, string | number>) => translate(L, key, p);
  const bullets: Item[] = [];
  const pct = f['revenue.change_pct'];
  bullets.push({
    text: pct ? t(pct.value >= 0 ? 'mgrai.tpl.revenueUp' : 'mgrai.tpl.revenueDown', { sum: money('revenue.net'), pct: Math.abs(pct.value) })
      : t('mgrai.tpl.revenue', { sum: money('revenue.net'), prev: money('revenue.net_last_week') }),
    fact_keys: pct ? ['revenue.net', 'revenue.change_pct'] : ['revenue.net', 'revenue.net_last_week'],
  });
  bullets.push({ text: t('mgrai.tpl.visits', { done: v('visits.completed'), noShow: v('visits.no_show'), cancelled: v('visits.cancelled') }), fact_keys: ['visits.completed', 'visits.no_show', 'visits.cancelled'] });
  bullets.push({ text: t('mgrai.tpl.newPatients', { n: v('patients.new'), prev: v('patients.new_last_week') }), fact_keys: ['patients.new', 'patients.new_last_week'] });
  if (f['service.1.revenue']) bullets.push({ text: t('mgrai.tpl.topService', { name: f['service.1.revenue'].label ?? '', sum: money('service.1.revenue') }), fact_keys: ['service.1.revenue'] });
  if (f['doctor.1.completed']?.value) bullets.push({ text: t('mgrai.tpl.topDoctor', { name: f['doctor.1.completed'].label ?? '', n: v('doctor.1.completed') }), fact_keys: ['doctor.1.completed'] });
  if (v('refunds.count')) bullets.push({ text: t('mgrai.tpl.refunds', { n: v('refunds.count'), sum: money('refunds.total') }), fact_keys: ['refunds.count', 'refunds.total'] });

  const candidates: Alert[] = [];
  const alert = (key: string, msg: MessageKey, severity: Alert['severity'], p: Record<string, string | number> = { n: v(key) }, keys = [key]) => {
    if (v(key) > 0) candidates.push({ text: t(msg, p), fact_keys: keys, severity });
  };
  alert('camera.alerts_open', 'mgrai.tpl.cameraAlerts', 'critical');
  alert('stock.expired_in_stock', 'mgrai.tpl.expired', 'critical');
  alert('fiscal.missing', 'mgrai.tpl.fiscal', 'warning');
  alert('debts.invoices', 'mgrai.tpl.debts', 'warning', { n: v('debts.invoices'), sum: money('debts.total') }, ['debts.invoices', 'debts.total']);
  alert('stock.low_items', 'mgrai.tpl.lowStock', 'warning');
  alert('stock.expiring_30d', 'mgrai.tpl.expiring', 'warning');
  alert('warehouse.approvals_pending', 'mgrai.tpl.approvals', 'warning');
  alert('delivery.telegram_failed', 'mgrai.tpl.telegramFailed', 'info');
  alert('delivery.sms_failed', 'mgrai.tpl.smsFailed', 'info');
  alert('warehouse.requests_pending', 'mgrai.tpl.requests', 'info');
  return { bullets: bullets.slice(0, 6), alerts: candidates.slice(0, 3) };
}
