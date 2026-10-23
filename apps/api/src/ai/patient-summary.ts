// Patient-friendly visit summary («Bemor uchun xulosa») and the note → document helpers (docs/AI.md).
//
// The model only rewords what the signed note says. The server keeps it honest: every sentence that names a drug,
// a dosage form or a number that is not in the note (or in a prescription issued at this visit) is dropped; ICD-10
// codes are removed; red flags are kept only when the note itself has a warning; the follow-up line is written by the
// server from follow_up_date. Without a model (AI off / sample) the same sections come from a fixed template.
import { z } from 'zod';
import { cyrillicToLatin, latinToCyrillic, translate, type SummaryLanguage } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx } from '../core/context';
import { AiClient } from './ai-client';
import { answerLanguage } from './lang';
import { PatientIdentity, redact } from './redact';
import { humanDate } from '../telegram/texts';

/** The note fields the summary and the documents are built from. */
export type NoteSource = {
  complaints: string | null; anamnesis?: string | null; examination: string | null; diagnosis: string | null; recommendations: string | null;
  follow_up_date: string | null; icd10: { code: string; title: string }[];
};
/** Drug items of the prescriptions issued at this visit (not voided). */
export type RxItem = { name: string; dose?: string | null; frequency?: string | null; duration?: string | null; instructions?: string | null; form?: string | null };

// ---------------------------------------------------------------- text normalisation

/**
 * A spelling-insensitive skeleton of a word, so «Paracetamol», «Paratsetamol», «Парацетамол» and «Парацетамола»
 * compare equal at the start: Cyrillic → Latin, ks → x, ts → s, soft c → s, hard c → k, y → i, doubles collapsed.
 */
export function skeleton(s: string): string {
  return cyrillicToLatin(s).toLowerCase()
    .replace(/[‘’ʻʼ'`]/g, '')
    .replace(/ph/g, 'f').replace(/ks/g, 'x').replace(/ts/g, 's').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/y/g, 'i')
    .replace(/[^a-z\s]/g, ' ').replace(/([a-z])\1+/g, '$1').replace(/\s+/g, ' ').trim();
}
const words = (s: string) => s.split(/[^\p{L}‘’ʻʼ'`]+/u).filter(Boolean);
const numbersOf = (s: string) => [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => String(Number(m[0].replace(',', '.'))));
/** ICD-10 codes never reach the patient's text (the summary explains the diagnosis in words). */
export const stripCodes = (s: string) => s.replace(/\s*\(?\b[A-TV-Z]\d{2}(?:\.\d{1,2})?\b\)?/g, '').replace(/\s+([.,;:])/g, '$1').trim();
export const sentences = (s: string) => s.split(/(?<=[.!?;])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- drug reference (stems), cached

type Stem = { stem: string; id: string; inn: string };
let stemCache: { at: number; stems: Stem[] } | null = null;
/** Russian first words that are also everyday words («железа» is also a gland). */
const AMBIGUOUS = new Set(['jeleza']);
export async function drugStems(q: Q): Promise<Stem[]> {
  if (stemCache && Date.now() - stemCache.at < 10 * 60_000) return stemCache.stems;
  const rows = (await q.query(`SELECT id, inn, inn_ru FROM drugs WHERE active`)).rows as { id: string; inn: string; inn_ru: string }[];
  const stems: Stem[] = [];
  for (const r of rows) for (const name of [r.inn, r.inn_ru]) {
    const first = skeleton(name.split(/[\s+,(]/)[0] ?? '');
    if (first.length >= 5 && !AMBIGUOUS.has(first)) stems.push({ stem: first.slice(0, 8), id: r.id, inn: r.inn });
  }
  stemCache = { at: Date.now(), stems };
  return stems;
}

/** Name parts typical of drugs that may be missing from the reference list (amoxi-cillin, ome-prazol, ator-vastatin …). */
const DRUG_PARTS = ['silin', 'misin', 'oxasin', 'profen', 'prazol', 'sartan', 'statin', 'olol', 'pril', 'dipin', 'azol', 'siklin', 'tidin', 'fenak', 'semid', 'tiazid', 'mizol', 'tadin', 'parin', 'triptan'];
/** Dosage forms and drug classes: «take tablets», «antibiotic» are advice the note must contain. */
const FORM_STEMS = ['tablet', 'kapsul', 'sirop', 'sirup', 'ukol', 'iniek', 'iniex', 'injek', 'ampul', 'malham', 'antibiot', 'supozit', 'svekh', 'inex'];

export type Source = { sk: string; numbers: Set<string> };
export function sourceOf(texts: (string | null | undefined)[]): Source {
  const all = texts.filter(Boolean).join('\n');
  const numbers = new Set<string>();
  for (const n of numbersOf(all)) { numbers.add(n); numbers.add(String(Math.trunc(Number(n)))); }
  return { sk: ` ${skeleton(all)} `, numbers };
}

/** Why a sentence may not go to the patient (null: it may): a number, a drug or a dosage form that the note does not have. */
export function sentenceProblem(sentence: string, src: Source, stems: Stem[]): 'number' | 'drug' | null {
  for (const n of numbersOf(sentence)) if (!src.numbers.has(n)) return 'number';
  for (const w of words(sentence)) {
    const sk = skeleton(w).replace(/\s/g, '');
    if (sk.length < 5) continue;
    const hit = stems.find((s) => sk.startsWith(s.stem));
    if (hit) { if (!src.sk.includes(hit.stem)) return 'drug'; continue; }
    if (sk.length >= 6 && DRUG_PARTS.some((p) => sk.includes(p)) && !src.sk.includes(sk.slice(0, 6))) return 'drug';
    const form = FORM_STEMS.find((f) => sk.startsWith(f.trim()));
    if (form && !src.sk.includes(form.trim())) return 'drug';
  }
  return null;
}

/** Keeps the sentences of `text` that pass the check; counts the dropped ones. */
export function filterText(text: string, src: Source, stems: Stem[], dropped: { n: number }): string {
  const keep: string[] = [];
  for (const s of sentences(stripCodes(text))) {
    if (sentenceProblem(s, src, stems)) dropped.n++;
    else keep.push(s);
  }
  return keep.join(' ');
}

// ---------------------------------------------------------------- the summary text

/** Words in a note that mean «come back at once if …» — red flags exist only when the note has one of them. */
const RED_FLAG_CUES = /darhol|zudlik|shoshilinch|tez\s*yordam|\b103\b|kuchays|yomonlash|yaxshilanmas|ko‘tarilsa|oshsa|davom\s*etsa|срочно|немедленн|скор(ую|ой)|ухудш|не\s*улучш|усил/i;
export const noteHasRedFlags = (n: NoteSource) => RED_FLAG_CUES.test(`${n.recommendations ?? ''}\n${n.diagnosis ?? ''}\n${n.examination ?? ''}`);

export type SummaryParts = { found: string; steps: string[]; red_flags: string[] };

/** The plain text the doctor edits and the patient receives: headings in the patient's language, the follow-up line from the note's date. */
export function assembleSummary(lang: SummaryLanguage, p: SummaryParts, followUpDate: string | null): string {
  const out: string[] = [];
  if (p.found.trim()) out.push(`${translate(lang, 'ps.h.found')}\n${p.found.trim()}`);
  const steps = p.steps.map((s) => s.trim()).filter(Boolean);
  if (steps.length) out.push(`${translate(lang, 'ps.h.steps')}\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (followUpDate) out.push(`${translate(lang, 'ps.h.followUp')}\n${translate(lang, 'ps.followUpLine', { date: `${humanDate(followUpDate, lang, false)} ${followUpDate.slice(0, 4)}` })}`);
  const flags = p.red_flags.map((s) => s.trim()).filter(Boolean);
  if (flags.length) out.push(`${translate(lang, 'ps.h.redFlags')}\n${flags.map((s) => `• ${s}`).join('\n')}`);
  return out.join('\n\n');
}

/** Without a model: the diagnosis (codes removed), the recommendations as steps, warning sentences as red flags. */
export function templateParts(n: NoteSource, lang: SummaryLanguage): SummaryParts {
  // the note is written in Uzbek Latin; for a Cyrillic reader it is converted letter by letter (Russian is not translated)
  const conv = (s: string) => (lang === 'uz-Cyrl' && /[A-Za-z]/.test(s) ? latinToCyrillic(s) : s);
  const recs = sentences(n.recommendations ?? '');
  const flags = recs.filter((s) => RED_FLAG_CUES.test(s));
  return {
    found: conv(stripCodes(n.diagnosis ?? '')),
    steps: recs.filter((s) => !flags.includes(s)).map(conv),
    red_flags: flags.map(conv),
  };
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    red_flags: { type: 'array', items: { type: 'string' } },
  },
  required: ['found', 'steps', 'red_flags'],
  additionalProperties: false,
};
const summaryZ = z.object({ found: z.string().max(2000), steps: z.array(z.string().max(600)).max(15), red_flags: z.array(z.string().max(600)).max(8) });

const SUMMARY_SYSTEM = `Sen shifokorning tasdiqlangan klinik qaydini bemor tushunadigan oddiy tilga o‘giruvchi yordamchisan.
Qat’iy qoidalar:
1. Faqat qaydda yozilgan ma’lumotdan foydalan. Yangi tashxis, dori, doza, tekshiruv, maslahat yoki son QO‘SHMA. Dori nomi, doza va son faqat qaydda aynan bo‘lsa yoziladi.
2. Tibbiy atamalarni oddiy so‘zlar bilan tushuntir. MKB-10 kodlarini yozma.
3. found — «Sizda nima aniqlandi»: tashxis oddiy so‘zlar bilan, 1–3 qisqa gap.
4. steps — «Nima qilish kerak»: qayddagi tavsiyalar, har biri alohida qisqa qadam (bitta gap).
5. red_flags — «Qachon darhol shifokorga murojaat qiling»: FAQAT qaydda shunday holat aniq yozilgan bo‘lsa (masalan «yaxshilanmasa», «kuchaysa»). Aks holda bo‘sh ro‘yxat.
6. Qayta ko‘rik sanasini yozma — uni dastur o‘zi qo‘shadi.
7. Bemorning ismi, telefoni yoki [bemor], [telefon] kabi belgilarni yozma. Bemorga «siz» deb murojaat qil.`;

export type SummaryDraft = { mode: 'live' | 'sample' | 'off'; text: string; dropped: number; reason: string | null };

/**
 * The draft for the doctor: the model over the redacted note (live), else the template. Nothing is saved here.
 * `offReason` is the doctor-language line «why AI is off» (null in sample mode).
 */
export async function draftSummary(db: Db, ai: AiClient, ctx: Ctx, input: { note: NoteSource; rx: RxItem[]; patient: PatientIdentity; lang: SummaryLanguage; offReason: string | null }): Promise<SummaryDraft> {
  const { note, rx, patient, lang } = input;
  const mode = ai.clinicalMode(ctx.tenantId);
  if (mode !== 'live') return { mode, text: assembleSummary(lang, templateParts(note, lang), note.follow_up_date), dropped: 0, reason: mode === 'off' ? input.offReason : null };
  const red = (s: string | null | undefined) => (s ? redact(s, patient) : '');
  const payload = {
    diagnosis: red(note.diagnosis), complaints: red(note.complaints), examination: red(note.examination), recommendations: red(note.recommendations),
    prescription: rx.map((i) => ({ name: red(i.name), form: red(i.form), dose: red(i.dose), frequency: red(i.frequency), duration: red(i.duration), instructions: red(i.instructions) })),
    has_warnings_in_note: noteHasRedFlags(note),
  };
  const { value } = await ai.json({
    route: 'patient_summary', system: `${SUMMARY_SYSTEM}\n${answerLanguage(lang)}`, user: JSON.stringify(payload), schema: SUMMARY_SCHEMA, validate: summaryZ,
    effort: 'low', maxTokens: 3000, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
  });
  const stems = await drugStems(db.pool);
  const src = sourceOf([note.complaints, note.anamnesis, note.examination, note.diagnosis, note.recommendations, ...rx.flatMap((i) => [i.name, i.form, i.dose, i.frequency, i.duration, i.instructions])]);
  const dropped = { n: 0 };
  const parts: SummaryParts = {
    found: filterText(value.found, src, stems, dropped),
    steps: value.steps.map((s) => filterText(s, src, stems, dropped)).filter(Boolean),
    // warnings the note does not have are not the model's to add
    red_flags: noteHasRedFlags(note) ? value.red_flags.map((s) => filterText(s, src, stems, dropped)).filter(Boolean) : [],
  };
  if (!noteHasRedFlags(note)) dropped.n += value.red_flags.filter((s) => s.trim()).length;
  return { mode: 'live', text: assembleSummary(lang, parts, note.follow_up_date), dropped: dropped.n, reason: null };
}

// ---------------------------------------------------------------- documents: fill from the note (no model)

const DOSE = /(\d+(?:[.,]\d+)?)\s*(mg|mkg|mcg|g|ml|ME|TB|IU|мг|мкг|г|мл|ЕД|%)(?![\p{L}])/iu;
const FREQ = /(kuniga|sutkada)\s*\d+\s*(marta|mahal)|\d+\s*(marta|mahal)(\s*kuniga)?|\d+\s*раз[а]?\s*в\s*(день|сутки)|по\s*\d+\s*раз[а]?/iu;
const DURATION = /\d+\s*(kun|hafta|oy|дн(ей|я)|недел[ьию]|месяц\w*)(\s*davomida)?/iu;
const REST = /(\d+)\s*kun\w*\s*(?:uyda\s+)?(?:dam\s*olish|ishdan\s*ozod|mehnatdan\s*ozod)|(?:dam\s*olish|ishdan\s*ozod)\w*\s*(\d+)\s*kun/iu;

/** Prescription rows read from the recommendations: a sentence with a known drug or a dose becomes one row; the doctor completes it. */
export function prescriptionFromNote(recommendations: string, stems: Stem[]): { items: (RxItem & { drug_id: string | null })[]; rest: string } {
  const items: (RxItem & { drug_id: string | null })[] = [];
  const rest: string[] = [];
  for (const s of sentences(recommendations)) {
    const ws = words(s);
    const idx = ws.findIndex((w) => { const sk = skeleton(w).replace(/\s/g, ''); return sk.length >= 5 && stems.some((x) => sk.startsWith(x.stem)); });
    const dose = s.match(DOSE);
    if (idx < 0 && !dose) { rest.push(s); continue; }
    const hit = idx >= 0 ? stems.find((x) => skeleton(ws[idx]).replace(/\s/g, '').startsWith(x.stem)) : undefined;
    const name = idx >= 0 ? ws[idx] : s.slice(0, dose!.index).trim().split(/\s+/).slice(-2).join(' ');
    if (items.length >= 15 || name.length < 2) { rest.push(s); continue; }
    items.push({ name: name.replace(/^\p{Ll}/u, (c) => c.toUpperCase()), drug_id: hit?.id ?? null, form: null, dose: dose ? `${dose[1]} ${dose[2]}` : '',
      frequency: s.match(FREQ)?.[0] ?? '', duration: s.match(DURATION)?.[0] ?? '', instructions: null });
  }
  return { items, rest: rest.join(' ') };
}

export function restDaysFromNote(recommendations: string): number {
  const m = recommendations.match(REST);
  const n = Number(m?.[1] ?? m?.[2] ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(30, n)) : 0;
}

// ---------------------------------------------------------------- referral reason (AI route document_draft)

const REASON_SCHEMA = { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'], additionalProperties: false };
const reasonZ = z.object({ reason: z.string().max(1500) });
const REASON_SYSTEM = `Sen shifokorga yo‘llanma (napravleniye) uchun «yo‘llanma sababi» matnini yozishda yordam berasan. Shifokorning klinik qaydidan foydalanib,
qabul qiluvchi mutaxassisga nima uchun yuborilayotganini 2–4 qisqa gapda yoz: asosiy shikoyat, topilma va savol.
Qoidalar: faqat qaydda bor ma’lumot; yangi tashxis, dori, doza, tekshiruv natijasi yoki son qo‘shma; MKB-10 kodini yozma (u alohida maydonda); bemor ismini yozma.`;

/** Deterministic reason: the diagnosis, then the complaints. */
export const templateReason = (n: NoteSource) => [stripCodes(n.diagnosis ?? ''), n.complaints ?? ''].map((s) => s.trim().replace(/[.]$/, '')).filter(Boolean).join('. ').concat('.').replace(/^\.$/, '');

export async function draftReason(db: Db, ai: AiClient, ctx: Ctx, input: { note: NoteSource; patient: PatientIdentity; toSpecialty: string | null }): Promise<{ mode: 'live' | 'sample' | 'off'; reason: string; dropped: number }> {
  const mode = ai.clinicalMode(ctx.tenantId);
  if (mode !== 'live') return { mode, reason: templateReason(input.note), dropped: 0 };
  const { note, patient } = input;
  const red = (s: string | null | undefined) => (s ? redact(s, patient) : '');
  const { value } = await ai.json({
    route: 'document_draft', system: `${REASON_SYSTEM}\n${answerLanguage(ctx.locale)}`,
    user: JSON.stringify({ to: input.toSpecialty ?? '', complaints: red(note.complaints), anamnesis: red(note.anamnesis), examination: red(note.examination), diagnosis: red(note.diagnosis), recommendations: red(note.recommendations) }),
    schema: REASON_SCHEMA, validate: reasonZ, effort: 'low', maxTokens: 1500, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
  });
  const stems = await drugStems(db.pool);
  const src = sourceOf([note.complaints, note.anamnesis, note.examination, note.diagnosis, note.recommendations]);
  const dropped = { n: 0 };
  const reason = filterText(value.reason, src, stems, dropped);
  return { mode: 'live', reason: reason || templateReason(note), dropped: dropped.n };
}
