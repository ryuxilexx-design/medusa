// «Natija sharhi» — commentary on a verified lab result for the doctor (docs/AI.md). The server computes every fact:
// each parameter's value, unit, reference range and flag, the critical (panic) values, and the same parameter's
// previous verified values of this patient with the change. The model gets only these facts plus sex and an age band
// (no name, no number, no free text) and may only put them into words. Critical values are listed by the server
// before anything the model writes; a model sentence with a number that is not a cited fact, or with a diagnosis or
// treatment word, is dropped.
import { translate, type Locale, type MessageKey } from '@meduza/contracts';
import type { Db } from '../core/db';
import { TZ_OFFSET_MS } from '../core/clock';

/**
 * Default critical (panic) limits by parameter code, in the template's units — used when the service's lab template
 * gives no `crit_low` / `crit_high` of its own. Typical laboratory call-back limits; the clinic's laboratory head must
 * confirm them before real use (docs/AI.md).
 */
export const DEFAULT_CRITICAL: Record<string, { low?: number; high?: number }> = {
  HGB: { low: 70, high: 200 },      // g/L
  WBC: { low: 2, high: 30 },        // ×10⁹/L
  PLT: { low: 50, high: 1000 },     // ×10⁹/L
  GLU: { low: 2.8, high: 22 },      // mmol/L
  CREA: { high: 350 },              // µmol/L
  UREA: { high: 35 },               // mmol/L
  ALT: { high: 1000 },              // U/L
  AST: { high: 1000 },              // U/L
  INR: { high: 5 },
  PT: { high: 40 },                 // s
  TG: { high: 11.3 },               // mmol/L
  TSH: { high: 50 },                // mIU/L
};

export type Previous = { date: string; value: number; text: string; days_before: number };
export type LabParam = {
  code: string; name: string; unit: string; value: number; text: string;
  ref_low: number | null; ref_high: number | null; flag: 'low' | 'high' | 'normal';
  critical: 'low' | 'high' | null; crit_low: number | null; crit_high: number | null;
  previous: Previous[]; change: number | null; change_pct: number | null;
};
export type LabFacts = {
  order_id: string; service_name: string; verified_at: string; sex: string; age_band: string;
  params: LabParam[]; facts: Record<string, { value: number; label?: string }>;
};

const decimals = (s: string) => (s.includes('.') ? s.split('.')[1].length : 0);
const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const localDay = (d: Date | string) => new Date(new Date(d).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** «40–49», never the birth date. */
export function ageBand(birth: string | Date | null, at: string): string {
  if (!birth) return 'unknown';
  const b = typeof birth === 'string' ? birth.slice(0, 10) : localDay(birth);
  let age = Number(at.slice(0, 4)) - Number(b.slice(0, 4));
  if (at.slice(5) < b.slice(5)) age--;
  if (age < 1) return '0';
  if (age < 5) return '1–4';
  if (age < 12) return '5–11';
  if (age < 18) return '12–17';
  if (age < 30) return '18–29';
  if (age >= 80) return '80+';
  const d = Math.floor(age / 10) * 10;
  return `${d}–${d + 9}`;
}

/**
 * Facts of one verified lab order: the parameters with flags and critical marks, and up to 3 previous verified values
 * of the same parameter for this patient (same tenant, verified before this one), the latest first, with the change.
 */
export async function buildLabFacts(db: Db, order: any): Promise<LabFacts> {
  const at = localDay(order.verified_at);
  const prev = await db.rows(
    `SELECT lr.values, lr.verified_at FROM service_orders o JOIN lab_results lr ON lr.order_id = o.id
      WHERE o.tenant_id = $1 AND o.patient_id = $2 AND o.category = 'lab' AND o.status = 'verified' AND lr.status = 'verified'
        AND o.id <> $3 AND lr.verified_at < $4
      ORDER BY lr.verified_at DESC LIMIT 20`, [order.tenant_id, order.patient_id, order.id, order.verified_at]);
  const template: any[] = order.lab_template ?? [];
  const params: LabParam[] = (order.values as any[]).filter((v) => v.value !== '' && v.value != null).map((v) => {
    const text = String(v.value);
    const value = Number(text);
    const tpl = template.find((p) => p.code === v.code) ?? {};
    const crit = DEFAULT_CRITICAL[v.code] ?? {};
    const critLow = num(tpl.crit_low) ?? crit.low ?? null, critHigh = num(tpl.crit_high) ?? crit.high ?? null;
    const previous: Previous[] = [];
    for (const r of prev) {
      const pv = (r.values as any[]).find((x) => x.code === v.code && x.value !== '' && x.value != null);
      if (!pv) continue;
      const d = localDay(r.verified_at);
      previous.push({ date: d, value: Number(pv.value), text: String(pv.value), days_before: dayDiff(d, at) });
      if (previous.length === 3) break;
    }
    const last = previous[0];
    const dec = last ? Math.max(decimals(text), decimals(last.text)) : 0;
    return {
      code: v.code, name: v.name, unit: v.unit ?? '', value, text,
      ref_low: num(v.ref_low), ref_high: num(v.ref_high), flag: v.flag === 'low' || v.flag === 'high' ? v.flag : 'normal',
      critical: critLow !== null && value < critLow ? 'low' : critHigh !== null && value > critHigh ? 'high' : null,
      crit_low: critLow, crit_high: critHigh,
      previous,
      change: last ? roundTo(value - last.value, dec) : null,
      change_pct: last && last.value !== 0 ? Math.round(((value - last.value) / Math.abs(last.value)) * 100) : null,
    };
  });
  const facts: LabFacts['facts'] = {};
  const put = (k: string, value: number | null, label?: string) => { if (value !== null && Number.isFinite(value)) facts[k] = { value, ...(label ? { label } : {}) }; };
  for (const p of params) {
    put(`${p.code}.value`, p.value, p.name);
    put(`${p.code}.ref_low`, p.ref_low, p.name);
    put(`${p.code}.ref_high`, p.ref_high, p.name);
    p.previous.forEach((x, i) => { put(`${p.code}.prev${i + 1}`, x.value, p.name); put(`${p.code}.prev${i + 1}_days`, x.days_before, p.name); });
    put(`${p.code}.change`, p.change, p.name);
    put(`${p.code}.change_pct`, p.change_pct, p.name);
  }
  put('count.params', params.length);
  put('count.out_of_range', params.filter((p) => p.flag !== 'normal').length);
  put('count.critical', params.filter((p) => p.critical).length);
  return { order_id: order.id, service_name: order.service_name, verified_at: at, sex: order.sex ?? 'unspecified', age_band: ageBand(order.birth_date, at), params, facts };
}

/** What the model receives: facts only — no name, no patient number, no date of birth, no free text. */
export function promptPayload(f: LabFacts) {
  return {
    patient: { sex: f.sex, age_band: f.age_band },
    test: f.service_name,
    parameters: f.params.map((p) => ({
      code: p.code, name: p.name, unit: p.unit, value: p.value, ref_low: p.ref_low, ref_high: p.ref_high, flag: p.flag, critical: p.critical,
      previous: p.previous.map((x, i) => ({ key: `${p.code}.prev${i + 1}`, value: x.value, days_before: x.days_before })),
      change: p.change, change_pct: p.change_pct,
    })),
    fact_keys: f.facts,
  };
}

// ---------- the check ----------

/** Diagnosis, disease and treatment words (uz Latin, uz Cyrillic, ru): a sentence with one is dropped. */
const FORBIDDEN = new RegExp([
  'tashxis', 'diagnoz', 'davola', '\\bdori', 'tavsiya', 'buyur', '\\bdoza', '\\bmg\\b', 'preparat', 'kasallik', 'sindrom', 'anemiya', 'diabet',
  'gipotireoz', 'gipertireoz', 'infeksiya', 'yallig‘', 'pnevmon', 'saraton', 'onkolog', 'yetishmovchilik', 'sirroz', 'gepatit', 'leykoz', 'leykemiya', 'tromboz',
  'ташхис', 'даволаш', '(?<!\\p{L})дори', 'тавсия', 'буюр', 'касаллик',
  'диагноз', 'лечен', 'лечит', 'назнач', 'препарат', '(?<!\\p{L})доз', 'рекоменд', 'принимать', 'синдром', 'анеми', 'диабет', 'гипотиреоз', 'гипертиреоз', 'инфекц',
  'воспал', 'пневмон', '(?<!\\p{L})рак(?:а|ом|е|у)?(?!\\p{L})', 'онколог', 'недостаточност', 'цирроз', 'гепатит', 'лейкоз', 'лейкеми', 'тромбоз', 'свидетельствует о', 'указывает на',
].join('|'), 'iu');
export const hasForbidden = (text: string) => FORBIDDEN.test(text);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Numbers as written: «5,2», «−12», «18%». Lab values are small, so no thousands groups. */
export function labNumbers(text: string): { value: number; decimals: number }[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => {
    const s = m[0].replace(',', '.');
    return { value: Number(s), decimals: decimals(s) };
  });
}
/**
 * True when every number in the sentence equals a cited fact (sign ignored, at the precision written). Parameter names,
 * units and the test name are removed first: «HbA1c», «×10⁹/L» and «25-OH D vitamini» are not numbers the model stated.
 */
export function labNumbersMatch(text: string, cited: number[], f: LabFacts): boolean {
  let t = text;
  const words = [f.service_name, ...f.params.flatMap((p) => [p.name, p.unit, p.code])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const w of words) t = t.replace(new RegExp(esc(w), 'gi'), ' ');
  const values = cited.map((v) => Math.abs(v));
  return labNumbers(t).every((n) => values.some((v) => v === n.value || roundTo(v, n.decimals) === n.value));
}

export type Sentence = { text: string; fact_keys: string[] };
/** Keeps the model's sentences that cite known facts, state only those numbers and say nothing about diagnosis or treatment. */
export function checkSentences(items: Sentence[], f: LabFacts, max: number): { kept: Sentence[]; dropped: number } {
  const kept: Sentence[] = [];
  let dropped = 0;
  for (const it of items) {
    const keys = [...new Set(it.fact_keys)];
    const text = it.text.trim();
    const ok = text.length > 0 && keys.every((k) => Object.hasOwn(f.facts, k)) && !hasForbidden(text)
      && labNumbersMatch(text, keys.map((k) => f.facts[k].value), f);
    if (ok && kept.length < max) kept.push({ text, fact_keys: keys });
    else dropped++;
  }
  return { kept, dropped };
}

// ---------- server text (critical lines, template commentary) ----------

const show = (v: number | null) => (v === null ? '' : String(v));
export const refText = (p: LabParam) => (p.ref_low !== null && p.ref_high !== null ? `${p.ref_low}–${p.ref_high}` : p.ref_high !== null ? `≤ ${p.ref_high}` : p.ref_low !== null ? `≥ ${p.ref_low}` : '—');

/** The critical values, always first and always from the server. */
export function criticalLines(L: Locale, f: LabFacts): { code: string; text: string }[] {
  return f.params.filter((p) => p.critical).map((p) => ({
    code: p.code,
    text: translate(L, p.critical === 'high' ? 'labai.criticalHigh' : 'labai.criticalLow', {
      name: p.name, value: p.text, unit: p.unit, limit: show(p.critical === 'high' ? p.crit_high : p.crit_low), ref: refText(p),
    }),
  }));
}

/** The deterministic commentary (AI off, sample mode, or nothing usable from the model). */
export function templateCommentary(L: Locale, f: LabFacts): Sentence[] {
  const t = (k: MessageKey, p?: Record<string, string | number>) => translate(L, k, p);
  const out: Sentence[] = [];
  const abnormal = f.params.filter((p) => p.flag !== 'normal' && !p.critical);
  if (!f.params.some((p) => p.flag !== 'normal')) out.push({ text: t('labai.tpl.allNormal', { n: f.params.length }), fact_keys: ['count.params'] });
  for (const p of abnormal.slice(0, 3)) {
    out.push({ text: t(p.flag === 'high' ? 'labai.tpl.high' : 'labai.tpl.low', { name: p.name, value: p.text, unit: p.unit, ref: refText(p) }), fact_keys: [`${p.code}.value`] });
  }
  const trends = f.params.filter((p) => p.change !== null).sort((a, b) => Number(b.flag !== 'normal') - Number(a.flag !== 'normal') || Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0));
  for (const p of trends.slice(0, Math.max(1, 5 - out.length))) {
    const prev = p.previous[0];
    const key: MessageKey = p.change === 0 ? 'labai.tpl.same' : p.change! > 0 ? 'labai.tpl.up' : 'labai.tpl.down';
    out.push({
      text: t(key, { name: p.name, prev: prev.text, value: p.text, unit: p.unit, days: prev.days_before, change: show(Math.abs(p.change!)), pct: p.change_pct === null ? '—' : Math.abs(p.change_pct) }),
      fact_keys: [`${p.code}.value`, `${p.code}.prev1`, `${p.code}.change`],
    });
  }
  if (!trends.length && f.params.length) out.push({ text: t('labai.tpl.noPrevious'), fact_keys: [] });
  return out.slice(0, 5);
}
