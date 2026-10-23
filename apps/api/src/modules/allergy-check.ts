import { Q } from '../core/db';
import { invalid } from '../core/errors';

/**
 * Prescription safety check (migration 028, docs/DRUGS.md): every item against the patient's active allergies,
 * including partly cross-reactive classes, plus the duplicate-INN check. Pure reading — the caller decides what blocks.
 *
 * Allergy sources: structured rows (class / drug / free text, confirmed or only reported at reception) and the old
 * card field (allergy_state = 'known' + allergy_note) read as free text. Free text matches a class by its keywords
 * and a drug by its INN (Latin or Russian) written in it.
 *
 * Only a hit on a SEVERE allergy blocks (409 ALLERGY_CONFLICT without an override reason); any other hit is a warning.
 * Free-text and legacy allergies carry severity 'unknown', so they warn but never block.
 */

export type CheckItem = { drug_id?: string | null; name?: string | null };
export type DrugInfo = { id: string; inn: string; inn_ru: string; atc: string | null; forms: string[]; allergy_classes: string[]; prescription_only: boolean };
export type AllergyWarning = {
  item: number; drug: string;
  allergy_id: string | null; match: 'drug' | 'class' | 'cross';
  class_code: string | null; class_name_uz: string | null; class_name_ru: string | null;
  /** what the patient is allergic to: class name (uz / ru), drug INN, or the recorded text */
  allergen: string; allergen_ru: string; allergen_is_class: boolean; reaction: string | null; severity: string; source: string; blocking: boolean;
};
type ClassRow = { code: string; name_uz: string; name_ru: string; cross_reactive: string[]; keywords: string[] };

const low = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[‘’'`ʻʼ]/g, '');

export async function resolveDrugs(q: Q, items: CheckItem[]): Promise<(DrugInfo | null)[]> {
  const ids = [...new Set(items.map((i) => i.drug_id).filter(Boolean) as string[])];
  const names = [...new Set(items.filter((i) => !i.drug_id && i.name).map((i) => low(i.name).trim()))];
  const rows = (await q.query(
    `SELECT id, inn, inn_ru, atc, forms, allergy_classes, prescription_only FROM drugs
      WHERE id = ANY($1::uuid[]) OR (active AND (lower(inn) = ANY($2) OR lower(inn_ru) = ANY($2)))`, [ids, names])).rows as DrugInfo[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = items.map((it, i) => (it.drug_id && !byId.has(it.drug_id) ? i : -1)).filter((i) => i >= 0);
  if (missing.length) throw invalid(Object.fromEntries(missing.map((i) => [`body.items.${i}.drug_id`, 'Dori ro‘yxatda topilmadi'])));
  return items.map((it) => it.drug_id ? byId.get(it.drug_id)! : rows.find((r) => it.name && (low(r.inn) === low(it.name).trim() || low(r.inn_ru) === low(it.name).trim())) ?? null);
}

export async function checkPrescription(q: Q, tenantId: string, patientId: string, items: CheckItem[]) {
  const drugs = await resolveDrugs(q, items);
  // duplicate INN: the same drug twice in one prescription (picked or typed)
  const seen = new Map<string, number>();
  const dup: Record<string, string> = {};
  items.forEach((it, i) => {
    const key = drugs[i] ? `id:${drugs[i]!.id}` : it.name ? `name:${low(it.name).trim()}` : '';
    if (!key) return;
    if (seen.has(key)) dup[`body.items.${i}.name`] = 'Bu dori retseptda ikki marta yozilgan';
    else seen.set(key, i);
  });

  const classes = new Map<string, ClassRow>((await q.query(`SELECT code, name_uz, name_ru, cross_reactive, keywords FROM allergy_classes`)).rows.map((r: ClassRow) => [r.code, r]));
  const allergies = (await q.query(
    `SELECT a.id, a.class_code, a.drug_id, a.free_text, a.reaction, a.severity, a.source, d.inn AS drug_inn, d.inn_ru AS drug_inn_ru, d.allergy_classes AS drug_classes
       FROM patient_allergies a LEFT JOIN drugs d ON d.id = a.drug_id
      WHERE a.tenant_id = $1 AND a.patient_id = $2 AND a.withdrawn_at IS NULL
      ORDER BY a.recorded_at LIMIT 200`, [tenantId, patientId])).rows;
  const legacy = (await q.query(`SELECT allergy_state, allergy_note FROM patients WHERE id = $1 AND tenant_id = $2`, [patientId, tenantId])).rows[0];
  if (legacy?.allergy_state === 'known' && legacy.allergy_note)
    allergies.push({ id: null, class_code: null, drug_id: null, free_text: legacy.allergy_note, reaction: null, severity: 'unknown', source: 'card' });

  const keywordClasses = (text: string) => [...classes.values()].filter((c) => c.keywords.some((k) => text.includes(low(k)))).map((c) => c.code);
  // what each item is, as far as allergy goes: its classes (from the list, or keywords in a typed name) and its names
  const itemInfo = items.map((it, i) => {
    const d = drugs[i];
    const name = d ? d.inn : (it.name ?? '').trim();
    return { name, names: d ? [low(d.inn), low(d.inn_ru)] : [low(name)].filter((n) => n.length >= 4), drugId: d?.id ?? null,
      classes: d ? d.allergy_classes : name ? keywordClasses(low(name)) : [] };
  });

  const warnings: AllergyWarning[] = [];
  for (const a of allergies) {
    const text = low(a.free_text);
    const own = new Set<string>(a.class_code ? [a.class_code] : a.drug_id ? (a.drug_classes ?? []) : keywordClasses(text));
    const cross = new Set<string>([...own].flatMap((c) => classes.get(c)?.cross_reactive ?? []).filter((c) => !own.has(c)));
    const allergen = a.class_code ? classes.get(a.class_code)?.name_uz ?? a.class_code : a.drug_id ? a.drug_inn : a.free_text;
    const allergenRu = a.class_code ? classes.get(a.class_code)?.name_ru ?? a.class_code : a.drug_id ? a.drug_inn_ru : a.free_text;
    itemInfo.forEach((it, i) => {
      let match: AllergyWarning['match'] | null = null; let cls: string | null = null;
      if ((a.drug_id && it.drugId === a.drug_id) || (text && it.names.some((n) => n.length >= 4 && text.includes(n)))) match = 'drug';
      else if ((cls = it.classes.find((c) => own.has(c)) ?? null)) match = 'class';
      else if ((cls = it.classes.find((c) => cross.has(c)) ?? null)) match = 'cross';
      if (!match) return;
      const c = cls ? classes.get(cls) : null;
      warnings.push({ item: i, drug: it.name, allergy_id: a.id, match, class_code: cls, class_name_uz: c?.name_uz ?? null, class_name_ru: c?.name_ru ?? null,
        allergen, allergen_ru: allergenRu, allergen_is_class: !!a.class_code, reaction: a.reaction, severity: a.severity, source: a.source, blocking: a.severity === 'severe' });
    });
  }
  // the most dangerous first: blocking, then a direct hit before a cross-reaction
  const rank = { drug: 0, class: 1, cross: 2 };
  warnings.sort((x, y) => Number(y.blocking) - Number(x.blocking) || rank[x.match] - rank[y.match] || x.item - y.item);
  return { drugs, warnings, duplicates: dup };
}
