/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Referral partners and lead sources of the demo (migration 041, docs/REFERRALS.md): eight partners (doctors from
 * other polyclinics, med reps, a family clinic), about a quarter of the past visits referred by them with the percent
 * snapshotted on every service of the visit, a few bank-transfer payouts (one voided), and a lead source on every
 * card and visit.
 *
 * A post-pass over the finished seed with its own PRNG: the main sequence — and every seeded KPI — stays exactly as it
 * was. No money moves here: partner amounts are computed in reports, payouts are bank transfers on past days (no
 * drawer, no shift), so today's cash desk is untouched. All people and organisations are synthetic.
 */
import { addDays, DEMO_TIMEZONE_OFFSET_HOURS, SEED_IDS, sid, type SeedData } from './build';

type Row = Record<string, any>;

/**
 * The lead sources every clinic starts with — data, not interface text (the manager renames or switches them off).
 * `system` rows are what the code relies on: a bot booking uses 'telegram_bot', a referred visit defaults to 'referral'.
 * Keys never change (ensureLeadSources is idempotent by key).
 */
export const STARTER_LEAD_SOURCES: { key: string; name: string; system?: 'telegram_bot' | 'referral' }[] = [
  { key: 'instagram', name: 'Instagram' },
  { key: 'telegram', name: 'Telegram' },
  { key: 'facebook', name: 'Facebook' },
  { key: 'google', name: 'Google/sayt' },
  { key: 'friend', name: 'Tanish tavsiyasi' },
  { key: 'referral', name: 'Yo‘llovchi shifokor', system: 'referral' },
  { key: 'banner', name: 'Banner/ko‘cha reklamasi' },
  { key: 'radio_tv', name: 'Radio/TV' },
  { key: 'other', name: 'Boshqa' },
  { key: 'telegram_bot', name: 'Telegram bot', system: 'telegram_bot' },
];
export const leadSourceSeedId = (tenantId: string, key: string) => sid(`lead:${tenantId}:${key}`);
export const partnerSeedId = (code: number) => sid(`partner:${code}`);

/** code, name, kind, workplace, specialty, region, default %, active */
const PARTNERS: [number, string, string, string, string | null, string, number, boolean][] = [
  [101, 'Rustamov Anvar Baxtiyorovich', 'doctor', 'Chilonzor tumani ko‘p tarmoqli poliklinikasi (demo)', 'Terapevt', 'Chilonzor', 20, true],
  [102, 'Ergasheva Dildora Shuhratovna', 'doctor', '5-son oilaviy poliklinika (demo)', 'Pediatr', 'Yunusobod', 15, true],
  [103, 'Qodirov Bahrom Ilhomovich', 'med_rep', 'MedFarm Distribution (demo)', null, 'Toshkent sh.', 10, true],
  [104, 'Nurmatova Shahlo Akramovna', 'doctor', 'Shahar kardiologiya dispanseri (demo)', 'Kardiolog', 'Mirzo Ulug‘bek', 25, true],
  [105, '«Sog‘lom Oila» oilaviy klinikasi', 'clinic', 'Sergeli tumani, Yangi Sergeli ko‘chasi (demo)', null, 'Sergeli', 30, true],
  [106, 'Tursunov Javlon Erkinovich', 'doctor', 'Zangiota qishloq vrachlik punkti (demo)', 'Umumiy amaliyot shifokori', 'Toshkent viloyati', 20, true],
  [107, 'Saidova Feruza Rashidovna', 'med_rep', 'Pharm Vision (demo)', null, 'Yakkasaroy', 10, true],
  [108, 'Abdullayev Sanjar Toxirovich', 'other', 'Fitnes markazi murabbiyi (demo)', null, 'Yunusobod', 12, false],
];
/** lead source weights of a card that was not referred (the rest of the starter list) */
const WEIGHTS: [string, number][] = [['instagram', 24], ['telegram', 14], ['facebook', 6], ['google', 10], ['friend', 26], ['banner', 6], ['radio_tv', 4], ['other', 10]];

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const at = (date: string, minutes: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 0, minutes) - DEMO_TIMEZONE_OFFSET_HOURS * 3600_000); };
const SO = 100;

/** Adds the referral and lead-source rows to a finished seed (mutates `data`). */
export function applyReferrals(data: SeedData, demoDate: string): void {
  const rnd = mulberry32(20261041);
  const T = SEED_IDS.tenant;
  const created = at(addDays(demoDate, -90), 9 * 60);
  // ---- lead sources: the starter list for every seed clinic ----
  for (const t of data.tenants) STARTER_LEAD_SOURCES.forEach((s, i) => data.lead_sources.push({
    id: leadSourceSeedId(t.id, s.key), tenant_id: t.id, name: s.name, system_key: s.system ?? null, starter_key: s.key, active: true, sort: (i + 1) * 10, created_at: created }));
  const src = (key: string) => leadSourceSeedId(T, key);
  const weighted = () => {
    let r = rnd() * WEIGHTS.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of WEIGHTS) { if ((r -= w) < 0) return k; }
    return 'other';
  };

  // ---- partners ----
  PARTNERS.forEach(([code, name, kind, workplace, specialty, region, pct, active], i) => data.referral_partners.push({
    id: partnerSeedId(code), tenant_id: T, code, full_name: name, phone: `+99890${String(5550100 + i * 37).padStart(7, '0')}`, kind, workplace, specialty, region,
    note: i === 4 ? 'Shartnoma: oyiga bir marta bank o‘tkazmasi (demo)' : null, default_percent: pct, active, created_by: SEED_IDS.membership.manager,
    created_at: created, updated_at: created }));
  for (const t of data.tenants) t.partner_seq = t.id === T ? PARTNERS[PARTNERS.length - 1][0] : 100;
  // the laboratory pays every partner 10 % (the margin is thin); the cardiologist gets 30 % of an echo she sends
  const svcByCode = new Map(data.services.filter((s) => s.tenant_id === T).map((s) => [s.code, s]));
  for (const s of data.services) s.partner_percent = s.tenant_id === T && s.category === 'lab' ? 10 : null;
  data.referral_partner_services.push({ tenant_id: T, partner_id: partnerSeedId(104), service_id: svcByCode.get('U05')!.id, percent: 30 });
  const pctFor = (partnerId: string, serviceId: string) => {
    const pair = data.referral_partner_services.find((x) => x.partner_id === partnerId && x.service_id === serviceId);
    if (pair) return Number(pair.percent);
    const s = data.services.find((x) => x.id === serviceId)!;
    if (s.partner_percent != null) return Number(s.partner_percent);
    return Number(data.referral_partners.find((p) => p.id === partnerId)!.default_percent);
  };

  // ---- visits: about a quarter of the past ones were referred ----
  const dayStart = at(demoDate, 0);
  const appts = data.appointments.filter((a) => a.tenant_id === T).sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime() || String(a.id).localeCompare(String(b.id)));
  const partnerOf = new Map<string, string>();
  for (const a of appts) {
    if (a.starts_at >= dayStart) continue;
    const roll = rnd();
    const pick = Math.floor(rnd() * PARTNERS.length); // the inactive partner sent patients before the clinic stopped working with him
    if (roll < 0.25) partnerOf.set(a.id, data.referral_partners[pick].id);
  }
  // ---- cards: the source of their first visit (a referral when it was referred), else a weighted draw ----
  const firstVisit = new Map<string, Row>();
  for (const a of appts) if (!firstVisit.has(a.patient_id)) firstVisit.set(a.patient_id, a);
  const patientSource = new Map<string, string | null>();
  for (const p of data.patients) {
    if (p.tenant_id !== T) { p.lead_source_id = null; continue; }
    const first = firstVisit.get(p.id);
    const unknown = rnd() < 0.08; // older cards: nobody asked
    const key = first && partnerOf.has(first.id) ? 'referral' : unknown ? null : weighted();
    p.lead_source_id = key ? src(key) : null;
    patientSource.set(p.id, p.lead_source_id);
  }
  for (const a of data.appointments) {
    const partner = partnerOf.get(a.id) ?? null;
    a.referral_partner_id = partner;
    a.lead_source_id = a.tenant_id !== T ? null : partner ? src('referral') : patientSource.get(a.patient_id) ?? null;
  }
  // every service of a referred visit carries the partner and the percent of that day
  for (const o of data.service_orders) {
    const partner = o.appointment_id ? partnerOf.get(o.appointment_id) ?? null : null;
    o.referral_partner_id = partner;
    o.partner_percent_snapshot = partner ? pctFor(partner, o.service_id) : 0;
  }

  // ---- payouts: bank transfers on past days, never more than was earned by then (one entered twice and voided) ----
  const invById = new Map(data.invoices.map((i) => [i.id, i]));
  const itemByOrder = new Map(data.invoice_items.map((it) => [it.order_id, it]));
  const earnedBy = (partnerId: string, until: Date) => {
    let sum = 0;
    for (const o of data.service_orders) {
      if (o.referral_partner_id !== partnerId || !['completed', 'verified'].includes(o.status) || !o.performed_at || o.performed_at >= until) continue;
      const it = itemByOrder.get(o.id); const inv = it && invById.get(it.invoice_id);
      if (!it || !inv || inv.status === 'void') continue;
      sum += Math.round(((Number(it.line_total) - Number(it.refunded_amount ?? 0)) * Number(o.partner_percent_snapshot)) / 100);
    }
    return sum;
  };
  const round10k = (t: number) => Math.floor(t / (10_000 * SO)) * 10_000 * SO;
  let n = 0;
  const PAYDAYS = [-21, -7];
  for (const p of data.referral_partners) {
    let paid = 0;
    for (const back of PAYDAYS) {
      // three weeks ago everyone but #106 got ~60 % of what they had earned; a week ago only #101, #103 and #105 were paid
      if (p.code === 106 || (back === -7 && ![101, 103, 105].includes(p.code))) continue;
      const when = at(addDays(demoDate, back), 15 * 60 + (p.code % 7) * 10);
      const amount = round10k((earnedBy(p.id, when) - paid) * 0.6);
      if (amount < 50_000 * SO) continue;
      paid += amount; n++;
      data.partner_payouts.push({ id: sid(`payout:${p.code}:${back}`), tenant_id: T, branch_id: SEED_IDS.branchCentral, partner_id: p.id, amount, method: 'transfer', shift_id: null,
        note: `${n}-to‘lov, bank o‘tkazmasi (demo)`, paid_at: when, created_by: SEED_IDS.membership.manager, created_by_name: 'Dilnoza Karimova', idempotency_key: `seed-payout-${p.code}-${-back}`,
        status: 'active', void_reason: null, voided_at: null, voided_by_name: null });
      if (p.code === 101 && back === -7) {
        // the same transfer typed in twice: the copy is voided with a reason (append-only, never deleted)
        data.partner_payouts.push({ id: sid(`payout:${p.code}:${back}:dup`), tenant_id: T, branch_id: SEED_IDS.branchCentral, partner_id: p.id, amount, method: 'transfer', shift_id: null,
          note: 'Takror kiritilgan (demo)', paid_at: new Date(when.getTime() + 5 * 60_000), created_by: SEED_IDS.membership.manager, created_by_name: 'Dilnoza Karimova',
          idempotency_key: `seed-payout-${p.code}-${-back}-dup`, status: 'void', void_reason: 'Ikki marta kiritilgan', voided_at: new Date(when.getTime() + 20 * 60_000), voided_by_name: 'Dilnoza Karimova' });
      }
    }
  }
}
