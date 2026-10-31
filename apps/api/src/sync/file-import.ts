// «Import from file»: a MedPlus Excel/CSV export → the same records the bridge sends → the same upsert path
// (ingest.ts), keyed by the MedPlus ID column — a file import and the bridge never duplicate each other.
// Columns are guessed from MedPlus's Russian headers («ФИО пациента», «Дата рож.», «Оплаченная сумма», …) and the
// manager can correct the guess. Used by the manager's page and by `npm run db:import-medplus`.
import { readTable, Table, XCell } from '../core/xlsx';
import { stableHash } from './normalize';

export const IMPORT_KINDS = ['patients', 'payments', 'services'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
/** Largest file and most data rows one import takes (a bigger history goes through the CLI in parts or the bridge). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 30_000;
/** A preview (dry run) checks this many rows. */
export const PREVIEW_ROWS = 1000;

type Field = { key: string; required?: boolean; money?: boolean; headers: string[] };
/** Fields per kind and the MedPlus headers that point at them (lowercase, «ё» → «е», punctuation dropped). */
export const IMPORT_FIELDS: Record<ImportKind, Field[]> = {
  patients: [
    { key: 'external_id', required: true, headers: ['id', 'id пациента', 'код пациента', 'код', 'patient id', 'bemor id', 'номер пациента'] },
    { key: 'full_name', headers: ['фио пациента', 'фио', 'пациент', 'ф и о', 'fio', 'bemor', 'f i sh'] },
    { key: 'last_name', headers: ['фамилия', 'familiya'] },
    { key: 'first_name', headers: ['имя', 'ism'] },
    { key: 'middle_name', headers: ['отчество', 'otasining ismi'] },
    { key: 'birth_date', required: true, headers: ['дата рож', 'дата рождения', 'дата рожд', 'д р', 'tug‘ilgan sana', 'tugilgan sana'] },
    { key: 'sex', headers: ['пол', 'jinsi'] },
    { key: 'phone', headers: ['мобильный телефон', 'мобильный', 'моб телефон', 'телефон', 'тел', 'telefon'] },
    { key: 'phone2', headers: ['домашний телефон', 'дом телефон', 'домашний'] },
    { key: 'pinfl', headers: ['пинфл', 'жшшир', 'pinfl', 'jshshir'] },
    { key: 'address', headers: ['адрес', 'manzil'] },
  ],
  payments: [
    { key: 'external_id', required: true, headers: ['id', 'id платежа', 'номер платежа', 'код платежа'] },
    { key: 'patient_id', headers: ['id пациента', 'код пациента', 'номер пациента', 'bemor id'] },
    { key: 'patient', headers: ['пациент', 'фио пациента', 'фио', 'bemor'] },
    { key: 'amount', required: true, money: true, headers: ['оплаченная сумма', 'сумма оплаты', 'оплачено', 'сумма', 'summa'] },
    { key: 'method', required: true, headers: ['форма оплаты', 'способ оплаты', 'вид оплаты', 'tolov usuli', 'to‘lov usuli'] },
    { key: 'paid_at', required: true, headers: ['дата платежа', 'дата оплаты', 'дата и время', 'дата', 'время', 'sana'] },
    { key: 'cashier', headers: ['пользователь', 'кассир', 'kassir'] },
    { key: 'branch_name', headers: ['филиал', 'filial'] },
    { key: 'comment', headers: ['комментарий', 'примечание', 'izoh'] },
  ],
  services: [
    { key: 'external_id', headers: ['id', 'id услуги', 'код записи'] },
    { key: 'patient_id', headers: ['id пациента', 'код пациента', 'номер пациента', 'bemor id'] },
    { key: 'patient', headers: ['пациент', 'фио пациента', 'фио', 'bemor'] },
    { key: 'service_name', required: true, headers: ['услуга', 'наименование услуги', 'название услуги', 'xizmat'] },
    { key: 'price', required: true, money: true, headers: ['сумма', 'стоимость', 'цена', 'summa'] },
    { key: 'discount', money: true, headers: ['скидка', 'сумма скидки', 'chegirma'] },
    { key: 'quantity', headers: ['кол во', 'количество', 'soni'] },
    { key: 'doctor_name', headers: ['врач', 'доктор', 'shifokor'] },
    { key: 'doctor_percent', headers: ['врач %', '% врача', 'процент врача', 'врач процент'] },
    { key: 'ordered_at', required: true, headers: ['дата', 'дата услуги', 'дата оказания', 'sana'] },
    { key: 'branch_name', headers: ['филиал', 'filial'] },
  ],
};

export const normHeader = (h: unknown) => String(h ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[.,:;()«»"№#_\-/\\]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Header row: the first of the top 15 rows where at least two columns are recognised (exports often start with a title). */
export function findHeader(table: Table, kind: ImportKind): number { return findHeaderBy(table, IMPORT_FIELDS[kind]); }
export function findHeaderBy(table: Table, fields: { headers: string[] }[]): number {
  const known = new Set(fields.flatMap((f) => f.headers.map(normHeader)));
  for (let i = 0; i < Math.min(15, table.length); i++) if (table[i].filter((c) => known.has(normHeader(c))).length >= 2) return i;
  return 0;
}

/** field → column index guessed from the headers (each column used once; exact synonyms first, in the field's order). */
export function guessMapping(headers: unknown[], kind: ImportKind): Record<string, number> { return guessMappingBy(headers, IMPORT_FIELDS[kind]); }
export function guessMappingBy(headers: unknown[], fields: { key: string; headers: string[] }[]): Record<string, number> {
  const norm = headers.map(normHeader);
  const used = new Set<number>(); const out: Record<string, number> = {};
  for (const f of fields) {
    for (const h of f.headers.map(normHeader)) {
      const i = norm.findIndex((x, j) => x === h && !used.has(j));
      if (i >= 0) { out[f.key] = i; used.add(i); break; }
    }
  }
  return out;
}

/** «1 250 000,50», «1250000.5 сум», 1250000.5 → tiyin. Negative allowed (a refund row of the cash history). */
export function moneyToTiyin(v: XCell): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = String(v).replace(/[\s  ]/g, '').replace(/(сум|so‘m|som|uzs)$/i, '').replace(/[−–]/g, '-');
  const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const t = Number(m[2]) * 100 + Number(((m[3] ?? '') + '00').slice(0, 2));
  return m[1] ? -t : t;
}

/** A spreadsheet date stays a wall-clock date; text passes through (ingest.ts parses both). */
const timeText = (v: XCell) => (v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : v == null ? null : String(v).trim());
const textOf = (v: XCell) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
/** The MedPlus patient id from a patient cell: «28354», «28354 - Каримов А.», «Каримов А. (28354)», «ID: 28354». */
export function patientIdFrom(v: XCell): string | null {
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  const s = String(v ?? '');
  const m = /^\s*(\d{1,10})\b/.exec(s) ?? /\((\d{1,10})\)/.exec(s) ?? /\bID[:\s]*(\d{1,10})\b/i.exec(s);
  return m ? m[1] : null;
}

export type ImportRowError = { row: number; code: string; field?: string };
export type Prepared = { records: { kind: string; external_id: string; data: Record<string, unknown> }[]; rowOf: Map<string, number>; errors: ImportRowError[]; total: number };

/**
 * Rows → batch records. Row numbers in errors are the spreadsheet's own (1-based, header included). A services-report
 * line without an ID gets a stable one from its content (the same file imported twice is still applied once).
 */
export function prepareRecords(table: Table, kind: ImportKind, mapping: Record<string, number>, headerRow: number, limit = IMPORT_MAX_ROWS): Prepared {
  const fields = IMPORT_FIELDS[kind];
  const records: Prepared['records'] = []; const rowOf = new Map<string, number>(); const errors: ImportRowError[] = [];
  const seen = new Map<string, number>();
  const data = table.slice(headerRow + 1);
  let total = 0;
  for (let r = 0; r < data.length; r++) {
    const row = data[r]; const rowNo = headerRow + r + 2;
    if (!row.some((c) => c != null && c !== '')) continue;
    total++;
    if (records.length + errors.length >= limit) continue;
    const get = (k: string) => (mapping[k] === undefined || mapping[k] < 0 ? null : row[mapping[k]] ?? null);
    const v: Record<string, unknown> = {};
    let bad: ImportRowError | null = null;
    for (const f of fields) {
      const cell = get(f.key);
      if (f.money) {
        const t = moneyToTiyin(cell);
        if (cell != null && cell !== '' && t === null) { bad = { row: rowNo, code: 'bad_amount', field: f.key }; break; }
        v[f.key] = t;
      } else if (/_at$/.test(f.key)) v[f.key] = timeText(cell);
      else if (f.key === 'birth_date') v[f.key] = cell instanceof Date ? cell.toISOString().slice(0, 10) : textOf(cell);
      else if (f.key === 'quantity' || f.key === 'doctor_percent') v[f.key] = typeof cell === 'number' ? cell : textOf(cell)?.replace(',', '.').replace('%', '').trim() || null;
      else v[f.key] = textOf(cell);
    }
    if (!bad) for (const f of fields) if (f.required && (v[f.key] == null || v[f.key] === '')) { bad = { row: rowNo, code: 'missing', field: f.key }; break; }
    if (!bad && kind !== 'patients' && !v.patient_id) {
      const id = patientIdFrom(get('patient'));
      if (id) v.patient_id = id; else bad = { row: rowNo, code: 'missing', field: 'patient_id' };
    }
    if (!bad && kind === 'patients' && !v.full_name && !v.last_name) bad = { row: rowNo, code: 'missing', field: 'full_name' };
    if (bad) { errors.push(bad); continue; }
    let ext = String(v.external_id ?? '').trim();
    if (!ext) {
      // no ID column in a services report: a content key (patient, date, service, sum) + its repeat number in the file
      const base = 'f:' + stableHash([v.patient_id, v.ordered_at, v.service_name, v.price, v.discount, v.doctor_name]).slice(0, 20);
      const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      ext = n > 1 ? `${base}-${n}` : base;
    }
    delete v.external_id; delete v.patient;
    if (rowOf.has(ext)) { errors.push({ row: rowNo, code: 'duplicate_id' }); continue; }
    rowOf.set(ext, rowNo);
    if (kind === 'patients') records.push({ kind: 'patient', external_id: ext, data: v });
    else if (kind === 'payments') records.push({ kind: 'payment', external_id: ext, data: v });
    else records.push({ kind: 'order', external_id: ext, data: { ...v, quantity: v.quantity ?? 1 } });
  }
  return { records, rowOf, errors, total };
}

/** Reads the file and finds its header row and column guess. */
export function readImport(buf: Buffer, kind: ImportKind) {
  const table = readTable(buf);
  const headerRow = findHeader(table, kind);
  const headers = (table[headerRow] ?? []).map((h) => (h == null ? '' : String(h instanceof Date ? h.toISOString().slice(0, 10) : h)));
  return { table, headerRow, headers, guess: guessMapping(headers, kind) };
}
