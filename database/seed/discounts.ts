/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Discounts, benefit categories and corporate payers of the demo (migration 043, docs/DISCOUNTS_COMPANIES.md):
 * five discount rules, four benefit categories, three companies (an insurer and two employers), cards that carry a
 * category or a company, and on past visits a second bill of extra procedures — a benefit discount paid by the patient,
 * or a company split with the company's bank transfers on later days (one transfer typed in wrong and voided).
 *
 * A post-pass over the finished seed with its own PRNG: the main sequence and every seeded KPI stay exactly as they
 * were. Every new bill is on a past day and the patient's part of it is paid in full, so «today» (28 visits,
 * 2 510 000 so‘m in 12 payments) and the patient debt (6 315 000 so‘m on 46 bills) do not move; the companies' unpaid
 * parts are company receivables, never patient debt. All people and organisations are synthetic.
 */
import { addDays, DEMO_TIMEZONE_OFFSET_HOURS, SEED_IDS, sid, type SeedData } from './build';

type Row = Record<string, any>;
const SO = 100;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const at = (date: string, minutes: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 0, minutes) - DEMO_TIMEZONE_OFFSET_HOURS * 3600_000); };
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

export const discountRuleSeedId = (key: string) => sid(`disc-rule:${key}`);
export const benefitSeedId = (key: string) => sid(`benefit:${key}`);
export const companySeedId = (key: string) => sid(`company:${key}`);

/** key, name, kind, value (percent or so‘m), staff maximum, scope, categories, valid days from/to the demo date */
const RULES: [string, string, 'percent' | 'fixed', number, number, 'all' | 'categories', string[], number | null, number | null][] = [
  ['invalid', 'Imtiyozli 20 %', 'percent', 20, 20, 'all', [], null, null],
  ['pension', 'Pensionerlar 10 %', 'percent', 10, 10, 'all', [], null, null],
  ['family', 'Ko‘p bolali oilalar 15 %', 'percent', 15, 15, 'categories', ['consultation', 'procedure'], null, null],
  ['staff', 'Xodimlar oilasi 30 %', 'percent', 30, 10, 'all', [], null, null],
  ['labpromo', 'Laboratoriya aksiyasi −50 000', 'fixed', 50_000, 50_000, 'categories', ['lab'], -30, 60],
];
/** key, name, rule, requires a document, its label */
const CATEGORIES: [string, string, string, boolean, string | null][] = [
  ['invalid', 'Nogironlar', 'invalid', true, 'Nogironlik guvohnomasi №'],
  ['pension', 'Pensionerlar', 'pension', true, 'Pensiya guvohnomasi №'],
  ['family', 'Ko‘p bolali oilalar', 'family', true, 'Ma’lumotnoma №'],
  ['staff', 'Xodimlar oilasi', 'staff', false, null],
];
/** key, name, kind, INN, coverage %, coverage categories, terms (days), credit limit (so‘m), contract */
const COMPANIES: [string, string, 'employer' | 'insurance', string, number, string[], number, number, string][] = [
  ['insurer', '«Ishonch Sug‘urta» AJ (demo)', 'insurance', '301234567', 80, [], 30, 20_000_000, 'DMS-2026/014'],
  ['plant', '«Toshkent Metall» zavodi (demo)', 'employer', '302345678', 100, ['procedure', 'ultrasound', 'lab'], 15, 0, 'TM-07/2026'],
  ['it', '«DataSoft» MChJ (demo)', 'employer', '303456789', 50, [], 30, 5_000_000, 'DS-2026-3'],
];

/** Adds the discount and company rows to a finished seed (mutates `data`). */
export function applyDiscounts(data: SeedData, demoDate: string): void {
  const rnd = mulberry32(20261043);
  const T = SEED_IDS.tenant, BC = SEED_IDS.branchCentral;
  const MANAGER = { id: SEED_IDS.membership.manager, name: 'Dilnoza Karimova' };
  const created = at(addDays(demoDate, -90), 9 * 60);
  // ---- every row gets the new columns (the first row of a table decides the inserted columns) ----
  for (const p of data.patients) Object.assign(p, { benefit_category_id: null, benefit_note: null, company_id: null, company_member_no: null });
  for (const i of data.invoices) Object.assign(i, {
    discount_rule_id: null, discount_rule_name: null, discount_kind: null, discount_rule_value: null, discount_scope: null,
    discount_source: i.discount_type ? 'manual' : null, discount_benefit_category_id: null, discount_granted_by: i.discount_type ? MANAGER.id : null,
    discount_granted_by_name: i.discount_type ? i.discount_approved_by_name ?? MANAGER.name : null, discount_granted_at: i.discount_type ? i.created_at : null, discount_over_limit: false,
    company_id: null, company_percent: null, company_member_no: null, company_share_amount: 0, company_paid_amount: 0, company_set_by_name: null });
  for (const p of data.payments) p.company_payment_id = null;
  for (const o of data.service_orders) o.quantity = o.quantity ?? 1;

  // ---- directories ----
  for (const [key, name, kind, value, max, scope, cats, from, to] of RULES) data.discount_rules.push({
    id: discountRuleSeedId(key), tenant_id: T, name, kind, percent: kind === 'percent' ? value : null, amount: kind === 'fixed' ? value * SO : null,
    staff_max_percent: kind === 'percent' ? max : null, staff_max_amount: kind === 'fixed' ? max * SO : null, scope, categories: cats, service_ids: [],
    valid_from: from == null ? null : addDays(demoDate, from), valid_to: to == null ? null : addDays(demoDate, to), active: true, created_by: MANAGER.id, created_at: created, updated_at: created });
  for (const [key, name, rule, doc, label] of CATEGORIES) data.benefit_categories.push({
    id: benefitSeedId(key), tenant_id: T, name, discount_rule_id: discountRuleSeedId(rule), requires_document: doc, document_label: label, active: true, created_at: created, updated_at: created });
  COMPANIES.forEach(([key, name, kind, inn, cover, cats, terms, limit, contract], n) => data.companies.push({
    id: companySeedId(key), tenant_id: T, name, kind, inn, contract_number: contract, contract_date: addDays(demoDate, -120 + n * 9), contact_name: ['Rahimova Gulnora', 'Sobirov Akmal', 'Islomova Nigora'][n],
    contact_phone: `+99871${String(2003040 + n * 1111).padStart(7, '0')}`, note: kind === 'insurance' ? 'Ixtiyoriy tibbiy sug‘urta polisi bo‘yicha (demo)' : 'Xodimlarning davriy tibbiy ko‘rigi (demo)',
    discount_rule_id: null, coverage_percent: cover, coverage_categories: cats, payment_terms_days: terms, credit_limit: limit * SO, active: true, created_by: MANAGER.id, created_at: created, updated_at: created }));

  // ---- which past visits get a second bill: completed, not referred, not today, not the demo script's patients ----
  const dayStart = at(demoDate, 0), from = at(addDays(demoDate, -56), 0);
  const scriptPatients = new Set(Array.from({ length: 16 }, (_, i) => SEED_IDS.patient(i)));
  const visits = data.appointments.filter((a) => a.tenant_id === T && a.status === 'completed' && !a.referral_partner_id && a.starts_at >= from && a.starts_at < dayStart && !scriptPatients.has(a.patient_id))
    .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime() || String(a.id).localeCompare(String(b.id)));
  // spread over the eight weeks: one visit from each 1/24 of the list (the next free patient when one is taken)
  const used = new Set<string>(), picked: Row[] = [];
  const step = visits.length / 24;
  for (let k = 0; k < 24; k++) {
    for (let j = Math.floor(k * step + rnd() * step); j < visits.length; j++) {
      const a = visits[j];
      if (used.has(a.patient_id) || picked.includes(a)) continue;
      used.add(a.patient_id); picked.push(a); break;
    }
  }
  // benefit bills and company bills alternate, so both kinds span the whole period
  picked.sort((x, y) => x.starts_at.getTime() - y.starts_at.getTime());
  const order = [...picked.filter((_, i) => i % 2 === 0), ...picked.filter((_, i) => i % 2 === 1)];
  picked.splice(0, picked.length, ...order);
  const svc = new Map(data.services.filter((s) => s.tenant_id === T).map((s) => [s.code, s]));
  const priceOf = (serviceId: string, when: Date) => Number(data.service_prices.filter((p) => p.service_id === serviceId && !p.branch_id && p.valid_from <= when)
    .sort((a, b) => b.valid_from.getTime() - a.valid_from.getTime())[0].amount);
  const doctorPct = new Map(data.doctors.map((d) => [d.id, Number(d.default_share_percent)]));
  const doctorMembership = new Map<string, string>(data.doctors.map((d) => [d.id, d.membership_id]));
  const cashierFor = (branch: string) => (branch === BC ? { id: SEED_IDS.membership.cashier, name: 'Nodira Aliyeva' } : { id: SEED_IDS.membership.cashier2, name: 'Jasur Toshmatov' });
  const registrarFor = (branch: string) => (branch === BC ? { id: SEED_IDS.membership.registrar, name: 'Malika Yusupova' } : { id: SEED_IDS.membership.registrar2, name: 'Shahzod Rahimov' });
  const patientById = new Map(data.patients.map((p) => [p.id, p]));
  let invNo = 8000, rcpNo = 48000, refundNo = Math.max(0, ...data.refunds.map((r) => Number(r.refund_number)));

  /** A second bill on a visit: the procedures ordered after the consultation, performed by the visit's doctor. */
  const bill = (a: Row, key: string, lines: [string, number][]) => {
    const enc = data.encounters.find((e) => e.appointment_id === a.id);
    const ordered = plus(a.starts_at, 20), performed = plus(a.starts_at, 40);
    const orders = lines.map(([code, qty], pos) => {
      const s = svc.get(code)!, price = priceOf(s.id, ordered), own = doctorPct.get(a.doctor_id) ?? 0;
      const o = { id: sid(`order:disc:${key}:${code}`), tenant_id: T, branch_id: a.branch_id, patient_id: a.patient_id, appointment_id: a.id, encounter_id: enc?.id ?? null,
        service_id: s.id, category: s.category, service_name: s.name, is_primary: false, price_snapshot: price, share_percent_snapshot: own > 0 ? own : Number(s.share_percent),
        doctor_id: a.doctor_id, performer_doctor_id: a.doctor_id, status: 'completed', ordered_at: ordered, performed_at: performed, created_by: doctorMembership.get(a.doctor_id) ?? registrarFor(a.branch_id).id,
        referral_partner_id: null, partner_percent_snapshot: 0, quantity: qty };
      data.service_orders.push(o);
      return { o, pos };
    });
    const invoiceId = sid(`invoice:disc:${key}`);
    const items = orders.map(({ o, pos }) => ({ id: sid(`item:${o.id}`), tenant_id: T, invoice_id: invoiceId, order_id: o.id, service_id: o.service_id, description: o.service_name,
      quantity: o.quantity, unit_price: o.price_snapshot, line_subtotal: o.price_snapshot * o.quantity, discount_share: 0, line_total: o.price_snapshot * o.quantity, position: pos, refunded_amount: 0, category: o.category }));
    invNo++;
    const inv: Row = { id: invoiceId, tenant_id: T, branch_id: a.branch_id, patient_id: a.patient_id, appointment_id: a.id, invoice_number: invNo, status: 'unpaid',
      subtotal: items.reduce((x, it) => x + it.line_subtotal, 0), discount_type: null, discount_value: null, discount_amount: 0, discount_reason: null, discount_approved_by_name: null,
      total: 0, paid_amount: 0, void_reason: null, version: 1, created_at: ordered, updated_at: ordered, promise_date: null, promise_note: null, credit_amount: 0, refunded_amount: 0, line_refunded_amount: 0,
      discount_rule_id: null, discount_rule_name: null, discount_kind: null, discount_rule_value: null, discount_scope: null, discount_source: null, discount_benefit_category_id: null,
      discount_granted_by: null, discount_granted_by_name: null, discount_granted_at: null, discount_over_limit: false,
      company_id: null, company_percent: null, company_member_no: null, company_share_amount: 0, company_paid_amount: 0, company_set_by_name: null };
    return { inv, items, a };
  };
  const pay = (inv: Row, amount: number, method: string, when: Date, cashier: { id: string; name: string }, extra: Row = {}) => {
    rcpNo++;
    const p = { id: sid(`payment:disc:${inv.id}:${rcpNo}`), tenant_id: T, branch_id: inv.branch_id, invoice_id: inv.id, receipt_number: rcpNo, amount, method,
      cashier_membership_id: cashier.id, cashier_name: cashier.name, paid_at: when, note: null, idempotency_key: `seed-disc-${rcpNo}`, request_hash: null, shift_id: null, company_payment_id: null, ...extra };
    data.payments.push(p);
    inv.paid_amount += amount;
    return p;
  };
  const status = (inv: Row) => (inv.paid_amount === 0 ? 'unpaid' : inv.paid_amount >= inv.total ? 'paid' : 'partially_paid');
  const finish = (b: ReturnType<typeof bill>) => {
    b.inv.total = b.inv.subtotal - b.inv.discount_amount;
    for (const it of b.items) delete (it as Row).category;
    data.invoices.push(b.inv); data.invoice_items.push(...b.items);
  };

  // ---- benefit discounts: the first twelve picked visits (the patient pays the rest at the desk) ----
  const BENEFIT_LINES: Record<string, [string, number][][]> = {
    invalid: [[['P02', 5], ['P04', 1]], [['P03', 3]], [['P01', 1], ['P05', 1]]],
    pension: [[['P03', 5]], [['P01', 1], ['P02', 3]], [['P05', 1]]],
    family: [[['P02', 3]], [['P04', 2], ['P01', 1]], [['P03', 2]]],
    staff: [[['P01', 1], ['P05', 1]], [['P03', 4]], [['P02', 2]]],
  };
  const keys = ['invalid', 'pension', 'family', 'staff'];
  picked.slice(0, 12).forEach((a, n) => {
    const cat = keys[n % 4], rule = RULES.find((r) => r[0] === CATEGORIES.find((c) => c[0] === cat)![2])!;
    const p = patientById.get(a.patient_id)!;
    p.benefit_category_id = benefitSeedId(cat);
    p.benefit_note = CATEGORIES.find((c) => c[0] === cat)![3] ? `${['AB', 'PN', 'KB'][n % 3]}-${String(100000 + Math.floor(rnd() * 899999))} (demo)` : null;
    const b = bill(a, `b${n}`, BENEFIT_LINES[cat][Math.floor(n / 4)]);
    const [, ruleName, kind, value, max, scope, cats] = rule;
    for (const it of b.items) {
      if (scope === 'categories' && !cats.includes((it as Row).category)) continue;
      const d = Math.min(it.line_subtotal, Math.round((it.line_subtotal * Math.round(value * 100)) / 10000));
      it.discount_share = d; it.line_total = it.line_subtotal - d;
    }
    const over = value > max, cashier = cashierFor(a.branch_id);
    const granter = over ? MANAGER : cashier;
    Object.assign(b.inv, { discount_amount: b.items.reduce((x, it) => x + it.discount_share, 0), discount_rule_id: discountRuleSeedId(rule[0]), discount_rule_name: ruleName, discount_kind: kind,
      discount_rule_value: value, discount_scope: { scope, categories: cats, service_ids: [], order_ids: null }, discount_source: 'benefit', discount_benefit_category_id: benefitSeedId(cat),
      discount_granted_by: granter.id, discount_granted_by_name: granter.name, discount_granted_at: plus(b.inv.created_at, 3), discount_over_limit: over,
      discount_reason: over ? 'Klinika xodimining onasi — rahbar ruxsati (demo)' : null, discount_approved_by_name: over ? MANAGER.name : null });
    finish(b);
    pay(b.inv, b.inv.total, rnd() < 0.5 ? 'cash' : 'card', plus(b.inv.created_at, 25), cashier);
    b.inv.status = status(b.inv);
  });

  // ---- companies: the next twelve visits, four per company; the patient pays their part at once ----
  const COMPANY_LINES: [string, number][][] = [[['P01', 1], ['P05', 1]], [['P01', 1], ['P03', 2]], [['P05', 1], ['P04', 1]], [['P01', 1]]];
  const companyInvoices = new Map<string, Row[]>();
  picked.slice(12, 24).forEach((a, n) => {
    const [key, , , , cover, cats] = COMPANIES[n % 3];
    const companyId = companySeedId(key);
    const p = patientById.get(a.patient_id)!;
    p.company_id = companyId;
    p.company_member_no = key === 'insurer' ? `POL-${String(500000 + Math.floor(rnd() * 99999))}` : `TAB-${String(1000 + Math.floor(rnd() * 8999))}`;
    const b = bill(a, `c${n}`, COMPANY_LINES[Math.floor(n / 3)]);
    const covered = b.items.filter((it: Row) => !cats.length || cats.includes(it.category)).reduce((x, it) => x + it.line_total, 0);
    finish(b);
    const share = Math.min(b.inv.total, Math.round((covered * Math.round(cover * 100)) / 10000));
    Object.assign(b.inv, { company_id: companyId, company_percent: cover, company_member_no: p.company_member_no, company_share_amount: share, company_set_by_name: cashierFor(a.branch_id).name });
    if (b.inv.total > share) pay(b.inv, b.inv.total - share, 'card', plus(b.inv.created_at, 25), cashierFor(a.branch_id));
    b.inv.status = status(b.inv);
    companyInvoices.set(companyId, [...(companyInvoices.get(companyId) ?? []), b.inv]);
  });

  // ---- company bank transfers on past days: bills older than the cut-off are paid; one transfer was typed in wrong and voided ----
  let cpNo = 0;
  const companyPayment = (companyId: string, invs: Row[], when: Date, doc: string, voided: boolean) => {
    if (!invs.length) return;
    cpNo++;
    const cpId = sid(`company-payment:${companyId}:${cpNo}`);
    const amount = invs.reduce((x, i) => x + (i.company_share_amount - i.company_paid_amount), 0);
    data.company_payments.push({ id: cpId, tenant_id: T, company_id: companyId, number: cpNo, amount, method: 'transfer', document_number: doc, document_date: addDays(demoDate, Math.round((when.getTime() - dayStart.getTime()) / 86400_000) - 1),
      note: voided ? 'Summa noto‘g‘ri kiritilgan (demo)' : 'Bank ko‘chirmasi bo‘yicha (demo)', received_at: when, created_by: MANAGER.id, created_by_name: MANAGER.name, idempotency_key: `seed-cp-${cpNo}`,
      status: voided ? 'void' : 'active', void_reason: voided ? 'Boshqa kompaniyaning to‘lovi bilan adashtirilgan' : null, voided_at: voided ? plus(when, 15) : null, voided_by_name: voided ? MANAGER.name : null });
    for (const inv of invs) {
      const part = inv.company_share_amount - inv.company_paid_amount;
      const p = pay(inv, part, 'transfer', when, MANAGER, { note: `Kompaniya to‘lovi №${cpNo}`, company_payment_id: cpId });
      data.company_payment_allocations.push({ id: sid(`cp-alloc:${cpId}:${inv.id}`), tenant_id: T, company_payment_id: cpId, invoice_id: inv.id, payment_id: p.id, amount: part });
      inv.company_paid_amount += part;
      if (voided) {
        refundNo++;
        data.refunds.push({ id: sid(`refund:cpv:${p.id}`), tenant_id: T, branch_id: inv.branch_id, invoice_id: inv.id, payment_id: p.id, refund_number: refundNo, amount: part, method: 'transfer',
          reason_code: 'company_payment_void', reason: 'Boshqa kompaniyaning to‘lovi bilan adashtirilgan', shift_id: null, approved_by: MANAGER.id, approved_by_name: MANAGER.name,
          refunded_at: plus(when, 15), idempotency_key: `seed-cpv-${p.id}`, order_id: null });
        inv.paid_amount -= part; inv.company_paid_amount -= part;
      }
      inv.status = status(inv);
    }
  };
  const older = (companyId: string, days: number) => (companyInvoices.get(companyId) ?? []).filter((i) => i.created_at < at(addDays(demoDate, -days), 0));
  // the insurer pays monthly; the plant was paid twice (the first transfer was another company's and was voided); DataSoft is late
  companyPayment(companySeedId('plant'), older(companySeedId('plant'), 21), at(addDays(demoDate, -20), 11 * 60), 'p/t 118', true);
  companyPayment(companySeedId('insurer'), older(companySeedId('insurer'), 14), at(addDays(demoDate, -9), 15 * 60 + 30), 'p/t 2291', false);
  companyPayment(companySeedId('plant'), older(companySeedId('plant'), 12), at(addDays(demoDate, -5), 10 * 60 + 15), 'p/t 131', false);
  for (const t of data.tenants) {
    if (t.id !== T) { t.company_payment_seq = 0; continue; }
    t.company_payment_seq = cpNo;
    t.refund_seq = Math.max(Number(t.refund_seq ?? 0), refundNo);
  }
  // a few more cards with a category or a company and no bill yet (the registrar picks them at the next visit)
  const rest = data.patients.filter((p) => p.tenant_id === T && !scriptPatients.has(p.id) && !p.benefit_category_id && !p.company_id);
  rest.forEach((p, n) => {
    if (n % 11 === 3) { p.benefit_category_id = benefitSeedId(keys[n % 4]); p.benefit_note = keys[n % 4] === 'staff' ? null : `AB-${String(200000 + n * 37)} (demo)`; }
    else if (n % 13 === 6) { const k = COMPANIES[n % 3][0]; p.company_id = companySeedId(k); p.company_member_no = k === 'insurer' ? `POL-${600000 + n}` : `TAB-${2000 + n}`; }
  });
}
