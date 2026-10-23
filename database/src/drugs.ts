import * as fs from 'fs';
import * as path from 'path';
import type { PoolClient } from 'pg';

/**
 * Drug reference list (migration 028, docs/DRUGS.md). One CSV format for the starter list and an official import:
 *   inn;inn_ru;atc;forms;allergy_classes;prescription_only
 * forms and allergy_classes are `|`-separated codes; prescription_only is 1/0 (or true/false, ha/yo‘q).
 * Separator `;` (or tab, or `,` when the file has neither). A header row is optional.
 */
export const STARTER_DRUGS_CSV = path.resolve(__dirname, '../../seed/drugs.csv');

export interface DrugRow { inn: string; inn_ru: string; atc: string | null; forms: string[]; allergy_classes: string[]; prescription_only: boolean }

export function parseDrugsCsv(text: string): { rows: DrugRow[]; bad: number[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const first = lines.find((l) => l.trim()) ?? '';
  const sep = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const unq = (v: string | undefined) => (v ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"').trim();
  const list = (v: string) => unq(v).split('|').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const rows: DrugRow[] = [];
  const bad: number[] = [];
  let header = true;
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    const cols = l.split(sep);
    if (header) { header = false; if (/^inn$/i.test(unq(cols[0]))) return; }
    const [inn, ru, atcRaw, forms, classes, rx] = cols.map(unq);
    const atc = (atcRaw ?? '').toUpperCase() || null;
    const f = list(forms ?? ''), c = list(classes ?? '');
    if (!inn || inn.length < 2 || inn.length > 120 || !ru || ru.length > 120 || (atc && !/^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$/.test(atc))
      || f.some((x) => !/^[a-z_]{2,20}$/.test(x)) || c.some((x) => !/^[a-z][a-z0-9_]{1,40}$/.test(x))) { bad.push(i + 1); return; }
    rows.push({ inn, inn_ru: ru, atc, forms: f, allergy_classes: c, prescription_only: !/^(0|false|no|yo‘q|yo'q|нет)$/i.test(rx ?? '1') });
  });
  return { rows, bad };
}

/** Inserts or updates the rows; unknown allergy classes are reported (the row is kept without them). */
export async function upsertDrugs(q: Pick<PoolClient, 'query'>, rows: DrugRow[], source: 'starter' | 'official'): Promise<{ n: number; unknownClasses: string[] }> {
  const known = new Set((await q.query('SELECT code FROM allergy_classes')).rows.map((r) => r.code as string));
  const unknown = new Set<string>();
  for (const r of rows) {
    for (const c of r.allergy_classes) if (!known.has(c)) unknown.add(c);
    await q.query(
      `INSERT INTO drugs (inn, inn_ru, atc, forms, allergy_classes, prescription_only, source, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (lower(inn)) DO UPDATE SET inn_ru = EXCLUDED.inn_ru, atc = EXCLUDED.atc, forms = EXCLUDED.forms, allergy_classes = EXCLUDED.allergy_classes,
         prescription_only = EXCLUDED.prescription_only, source = EXCLUDED.source, active = true, updated_at = now()`,
      [r.inn, r.inn_ru, r.atc, r.forms, r.allergy_classes.filter((c) => known.has(c)), r.prescription_only, source]);
  }
  return { n: rows.length, unknownClasses: [...unknown] };
}

/** Loads the starter list (database/seed/drugs.csv) once, while the drug table is empty. Runs after the migrations. */
export async function ensureStarterDrugs(q: Pick<PoolClient, 'query'>): Promise<number> {
  const exists = (await q.query(`SELECT to_regclass('drugs') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) return 0;
  if ((await q.query('SELECT 1 FROM drugs LIMIT 1')).rowCount) return 0;
  if (!fs.existsSync(STARTER_DRUGS_CSV)) return 0;
  const { rows } = parseDrugsCsv(fs.readFileSync(STARTER_DRUGS_CSV, 'utf8'));
  return (await upsertDrugs(q, rows, 'starter')).n;
}
