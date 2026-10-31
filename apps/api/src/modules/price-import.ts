// Price-list import (docs/PRICE_LIST_IMPORT.md): a clinic's price list from MedPlus («Прейскурант» → Excel) or any
// spreadsheet → the services catalogue. One plan function decides every row (new / price changed / other fields
// changed / unchanged / error); the preview runs it on a read and stores nothing, the import runs it again inside one
// transaction (the clinic row locked like createService's code generator) and applies it. A price change is a new
// `service_prices` row from now on: orders keep their price snapshot, so past visits and invoices never change.
import { PoolClient } from 'pg';
import { readTable, Table, XCell } from '../core/xlsx';
import { findHeaderBy, guessMappingBy, moneyToTiyin, normHeader } from '../sync/file-import';
import { guessCategory } from '../sync/normalize';
import { PRICE_SQL } from './reference.controller';

export const PRICE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const PRICE_IMPORT_MAX_ROWS = 5000;
/** How many row outcomes a response lists (errors are listed separately, up to ERRORS_LISTED). */
export const ROWS_LISTED = 50;
export const ERRORS_LISTED = 200;
const MAX_PRICE = 1_000_000_000_00; // the same ceiling as the service form (contracts priceTiyin)

type Category = 'consultation' | 'lab' | 'ultrasound' | 'procedure';
type Field = { key: PriceField; required?: boolean; headers: string[] };
export type PriceField = 'name' | 'price' | 'category' | 'code' | 'ikpu' | 'vat' | 'duration';

/** Headers (Russian / Uzbek / English) that point at each field; compared after `normHeader`. */
export const PRICE_FIELDS: Field[] = [
  { key: 'name', required: true, headers: ['наименование', 'наименование услуги', 'название услуги', 'название', 'услуга', 'услуги', 'xizmat', 'xizmat nomi', 'xizmatlar', 'nomi', 'nomlanishi', 'service', 'name'] },
  { key: 'price', required: true, headers: ['цена', 'цена сум', 'цена услуги', 'стоимость', 'стоимость сум', 'стоимость услуги', 'сумма', 'прайс', 'narx', 'narxi', 'narx so‘m', 'narxi so‘m', 'price'] },
  { key: 'category', headers: ['категория', 'отделение', 'группа', 'раздел', 'тип', 'вид услуги', 'kategoriya', 'bo‘lim', 'bolim', 'guruh', 'turi', 'category'] },
  { key: 'code', headers: ['код', 'код услуги', 'артикул', 'шифр', 'kod', 'xizmat kodi', 'code'] },
  { key: 'ikpu', headers: ['икпу', 'код икпу', 'мхик', 'mxik', 'mxik kodi', 'ikpu', 'ikpu kodi'] },
  { key: 'vat', headers: ['ндс', 'ндс %', 'ставка ндс', 'qqs', 'qqs %', 'vat'] },
  { key: 'duration', headers: ['длительность', 'длительность мин', 'продолжительность', 'время мин', 'davomiylik', 'davomiyligi', 'davomiylik daq', 'duration'] },
];
const FIELD_KEYS = PRICE_FIELDS.map((f) => f.key);
/** Second pass for headers like «Цена, сум (с НДС)»: a header that starts with a synonym. IKPU/VAT first («Код ИКПУ» is not «Код»). */
const PREFIX_ORDER: PriceField[] = ['ikpu', 'vat', 'duration', 'name', 'price', 'category', 'code'];

export function guessPriceMapping(headers: unknown[]): Record<string, number> {
  const out = guessMappingBy(headers, PRICE_FIELDS);
  const norm = headers.map(normHeader);
  const used = new Set(Object.values(out));
  for (const key of PREFIX_ORDER) {
    if (out[key] !== undefined) continue;
    const syn = PRICE_FIELDS.find((f) => f.key === key)!.headers.map(normHeader);
    const i = norm.findIndex((x, j) => !used.has(j) && x && syn.some((h) => x.startsWith(h + ' ')));
    if (i >= 0) { out[key] = i; used.add(i); }
  }
  return out;
}

/** Only known fields, integer columns inside the table (−1 = not used). Anything else → null (a 422 for the caller). */
export function cleanMapping(raw: unknown, width: number): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!FIELD_KEYS.includes(k as PriceField)) continue;
    if (!Number.isInteger(v) || (v as number) < -1 || (v as number) >= Math.max(width, 1)) return null;
    if ((v as number) >= 0) out[k] = v as number;
  }
  return out;
}

export function readPriceList(buf: Buffer) {
  const table = readTable(buf);
  const headerRow = findHeaderBy(table, PRICE_FIELDS);
  const headers = (table[headerRow] ?? []).map((h) => (h == null ? '' : String(h instanceof Date ? h.toISOString().slice(0, 10) : h)));
  const width = table.reduce((m, r) => Math.max(m, r.length), 0);
  return { table, headerRow, headers, width, guess: guessPriceMapping(headers) };
}

// ---------------------------------------------------------------- cell parsing

const text = (v: XCell) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, ' ').trim() || null);

/**
 * So‘m in the file → tiyin: «150 000», «150 000,00», «150000.5», «150,000.00», «1.250.000», a number cell.
 * A grouping separator repeated or followed by a decimal one is dropped; «150.000» (one separator, three digits) is
 * ambiguous and refused rather than read as 150 so‘m.
 */
export function somToTiyin(v: XCell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v ?? '').replace(/[\s  ']/g, '').replace(/(сум|сўм|so‘m|so'm|som|uzs)\.?$/i, '');
  if (/[.,].*[.,]/.test(s)) {
    const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    const tail = s.slice(last + 1);
    const head = s.slice(0, last);
    if (tail.length === 3 && /^\d{1,3}([.,]\d{3})*$/.test(head)) s = head.replace(/[.,]/g, '') + tail; // 1.250.000
    else if (/^-?\d{1,3}([.,]\d{3})+$/.test(head) && /^\d{1,2}$/.test(tail)) s = head.replace(/[.,]/g, '') + '.' + tail; // 150,000.00
    else return null;
  }
  return moneyToTiyin(s);
}

/** Our category from a «Категория/Отделение» cell, or null when the text names none of them (then the name decides). */
export function categoryFromText(v: string | null): Category | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if ((['consultation', 'lab', 'ultrasound', 'procedure'] as const).includes(s as Category)) return s as Category;
  if (/узи|uzi|ультразв|допплер|эхо|ultrasound|экг/.test(s)) return 'ultrasound';
  if (/лаборат|laborat|анализ|tahlil|lab\b/.test(s)) return 'lab';
  if (/консульт|konsult|приём|прием|осмотр|qabul|ko‘rik|korik|consult/.test(s)) return 'consultation';
  if (/процедур|манипул|muolaja|protsedur|procedur|операц|operats/.test(s)) return 'procedure';
  return null;
}

type Vat = { vat_percent: number | null; vat_exempt: boolean };
function parseVat(v: XCell): Vat | 'bad' | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const p = v > 0 && v < 1 ? Math.round(v * 100) : v; // a percent-formatted cell holds 0.12
    return Number.isInteger(p) && p >= 0 && p <= 100 ? { vat_percent: p, vat_exempt: false } : 'bad';
  }
  const s = String(v).trim().toLowerCase();
  if (/без|освобожд|не облага|qqssiz|qqs siz|ozod|exempt|^нет$|^-$|^—$/.test(s)) return { vat_percent: null, vat_exempt: true };
  const m = /^(\d{1,3})(?:[.,]0+)?\s*%?$/.exec(s);
  if (!m || Number(m[1]) > 100) return 'bad';
  return { vat_percent: Number(m[1]), vat_exempt: false };
}

const DEFAULT_DURATION: Record<Category, number> = { consultation: 30, lab: 15, ultrasound: 20, procedure: 30 };
const CODE_PREFIX: Record<Category, string> = { consultation: 'C', lab: 'L', ultrasound: 'U', procedure: 'P' };

export type RowError = 'name' | 'price_missing' | 'price_bad' | 'price_negative' | 'code' | 'ikpu' | 'vat' | 'duration' | 'duplicate' | 'placeholder_name' | 'code_taken' | 'lab_template';
export type ParsedRow = {
  row: number; name: string | null; price: number | null; code: string | null; category: Category | null; category_text: string | null;
  ikpu: string | null; vat: Vat | null; duration: number | null; error?: { code: RowError; field?: PriceField };
};

/** Spreadsheet rows → parsed rows (row numbers are the sheet's own, 1-based, header included). Empty rows are skipped. */
export function parseRows(table: Table, headerRow: number, mapping: Record<string, number>): ParsedRow[] {
  const out: ParsedRow[] = [];
  const data = table.slice(headerRow + 1);
  for (let r = 0; r < data.length; r++) {
    const cells = data[r];
    if (!cells.some((c) => c != null && c !== '')) continue;
    const get = (k: PriceField): XCell => (mapping[k] === undefined || mapping[k] < 0 ? null : cells[mapping[k]] ?? null);
    const row: ParsedRow = { row: headerRow + r + 2, name: text(get('name')), price: null, code: null, category: null, category_text: null, ikpu: null, vat: null, duration: null };
    const fail = (code: RowError, field?: PriceField) => { if (!row.error) row.error = { code, field }; };
    if (!row.name || row.name.length < 2 || row.name.length > 120) fail('name', 'name');
    const priceCell = get('price');
    if (priceCell == null || priceCell === '') fail('price_missing', 'price');
    else {
      const t = somToTiyin(priceCell);
      if (t === null || t > MAX_PRICE) fail('price_bad', 'price');
      else if (t < 0) fail('price_negative', 'price');
      else row.price = t;
    }
    const code = text(get('code'));
    if (code && (code.length > 40 || /[\u0000-\u001f]/.test(code))) fail('code', 'code'); else row.code = code;
    row.category_text = text(get('category'));
    row.category = categoryFromText(row.category_text);
    const ikpuCell = get('ikpu');
    if (ikpuCell != null && ikpuCell !== '') {
      // a 17-digit number does not survive as a spreadsheet number (15 significant digits): it must be a text cell
      const s = typeof ikpuCell === 'number' ? (Number.isSafeInteger(ikpuCell) ? String(ikpuCell) : '') : String(ikpuCell).replace(/[\s -]/g, '');
      if (/^\d{17}$/.test(s)) row.ikpu = s; else fail('ikpu', 'ikpu');
    }
    const vat = parseVat(get('vat'));
    if (vat === 'bad') fail('vat', 'vat'); else row.vat = vat;
    const durCell = get('duration');
    if (durCell != null && durCell !== '') {
      const d = typeof durCell === 'number' ? durCell : Number(String(durCell).replace(/(мин|min|daq)\.?$/i, '').trim().replace(',', '.'));
      if (Number.isInteger(d) && d >= 5 && d <= 240) row.duration = d; else fail('duration', 'duration');
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------- plan

export type Existing = {
  id: string; code: string; name: string; category: Category; active: boolean; duration_min: number; has_template: boolean;
  ikpu_code: string | null; vat_percent: number | null; vat_exempt: boolean; price: number | null;
};
/** An inactive «MedPlus: …» service made by the mirror for an unmapped MedPlus service — never the real one. */
export const isPlaceholder = (s: Pick<Existing, 'name' | 'active'>) => !s.active && /^medplus: /i.test(s.name);

export type Outcome = 'created' | 'price_changed' | 'updated' | 'unchanged' | 'error';
export type RowOutcome = {
  row: number; outcome: Outcome; name: string | null; code: string | null; service_id?: string; matched_by?: 'code' | 'name';
  old_price?: number | null; price?: number | null; changes?: string[]; error?: RowError; field?: PriceField;
};
export type NewService = { code: string; name: string; category: Category; duration_min: number; price: number; ikpu_code: string | null; vat_percent: number | null; vat_exempt: boolean };
export type ServiceUpdate = { id: string; price: number | null; category: Category; duration_min: number; ikpu_code: string | null; vat_percent: number | null; vat_exempt: boolean; attrs: boolean };
export type Plan = { outcomes: RowOutcome[]; creates: NewService[]; updates: ServiceUpdate[]; counts: Record<Outcome, number> & { total: number } };

/**
 * Decides every row against the clinic's services. Match: the file's code when it names one of ours, else the
 * name (case-insensitive). Existing: the price (and category / IKPU / VAT / duration only when the file gives them).
 * New: an active service, category from the file or guessed from the name, the file's code when free.
 */
export function planImport(rows: ParsedRow[], existing: Existing[]): Plan {
  const real = existing.filter((s) => !isPlaceholder(s));
  const byCode = new Map(real.map((s) => [s.code.toLowerCase(), s]));
  const byName = new Map(real.map((s) => [s.name.toLowerCase(), s]));
  const placeholderNames = new Set(existing.filter(isPlaceholder).map((s) => s.name.toLowerCase()));
  const takenCodes = new Set(existing.map((s) => s.code.toLowerCase()));
  const seen = new Set<string>(); // matched service ids and new names of this file
  const outcomes: RowOutcome[] = []; const creates: NewService[] = []; const updates: ServiceUpdate[] = [];
  const counts = { total: rows.length, created: 0, price_changed: 0, updated: 0, unchanged: 0, error: 0 };
  const pending: { row: ParsedRow; idx: number }[] = []; // new services without a code from the file: numbered after the loop
  const err = (r: ParsedRow, code: RowError, field?: PriceField) => { counts.error++; outcomes.push({ row: r.row, outcome: 'error', name: r.name, code: r.code, error: code, field }); };

  for (const r of rows) {
    if (r.error) { err(r, r.error.code, r.error.field); continue; }
    const name = r.name!, price = r.price!;
    const hit = (r.code && byCode.get(r.code.toLowerCase())) || byName.get(name.toLowerCase());
    if (hit) {
      if (seen.has(hit.id)) { err(r, 'duplicate'); continue; }
      seen.add(hit.id);
      const category = r.category ?? hit.category;
      if (category !== 'lab' && hit.has_template) { err(r, 'lab_template', 'category'); continue; }
      const changes: string[] = [];
      const priceChanged = hit.price === null || Number(hit.price) !== price;
      if (priceChanged) changes.push('price');
      if (category !== hit.category) changes.push('category');
      const ikpu = r.ikpu ?? hit.ikpu_code;
      if (ikpu !== hit.ikpu_code) changes.push('ikpu');
      const vat = r.vat ?? { vat_percent: hit.vat_percent, vat_exempt: hit.vat_exempt };
      if (vat.vat_percent !== hit.vat_percent || vat.vat_exempt !== hit.vat_exempt) changes.push('vat');
      const duration = r.duration ?? hit.duration_min;
      if (duration !== hit.duration_min) changes.push('duration');
      const outcome: Outcome = priceChanged ? 'price_changed' : changes.length ? 'updated' : 'unchanged';
      counts[outcome]++;
      outcomes.push({ row: r.row, outcome, name: hit.name, code: hit.code, service_id: hit.id, matched_by: r.code && byCode.get(r.code.toLowerCase()) === hit ? 'code' : 'name',
        old_price: hit.price, price, changes });
      if (changes.length) updates.push({ id: hit.id, price: priceChanged ? price : null, category, duration_min: duration, ikpu_code: ikpu, ...vat, attrs: changes.some((c) => c !== 'price') });
      continue;
    }
    const lname = name.toLowerCase();
    if (placeholderNames.has(lname)) { err(r, 'placeholder_name', 'name'); continue; }
    if (seen.has('n:' + lname)) { err(r, 'duplicate'); continue; }
    if (r.code && takenCodes.has(r.code.toLowerCase())) { err(r, 'code_taken', 'code'); continue; }
    seen.add('n:' + lname);
    const category = r.category ?? guessCategory(name);
    const svc: NewService = { code: r.code ?? '', name, category, duration_min: r.duration ?? DEFAULT_DURATION[category], price, ikpu_code: r.ikpu, vat_percent: r.vat?.vat_percent ?? null, vat_exempt: r.vat?.vat_exempt ?? false };
    if (r.code) takenCodes.add(r.code.toLowerCase());
    else pending.push({ row: r, idx: creates.length });
    creates.push(svc);
    counts.created++;
    outcomes.push({ row: r.row, outcome: 'created', name, code: r.code, price });
  }
  // our own codes (C01, L07…) for the new services the file gave no code: after every file code is reserved
  const next: Record<string, number> = {};
  for (const p of pending) {
    const svc = creates[p.idx]; const prefix = CODE_PREFIX[svc.category];
    let n = next[prefix] ?? 1;
    while (takenCodes.has(`${prefix}${String(n).padStart(2, '0')}`.toLowerCase())) n++;
    svc.code = `${prefix}${String(n).padStart(2, '0')}`; takenCodes.add(svc.code.toLowerCase()); next[prefix] = n + 1;
    const o = outcomes.find((x) => x.row === p.row.row); if (o) o.code = svc.code;
  }
  return { outcomes, creates, updates, counts };
}

/** The clinic's services with their general price (`lock` = inside the import transaction). */
export async function loadServices(c: Pick<PoolClient, 'query'>, tenantId: string, lock = false): Promise<Existing[]> {
  const rows = (await c.query(
    `SELECT s.id, s.code, s.name, s.category, s.active, s.duration_min, s.lab_template IS NOT NULL AS has_template, s.ikpu_code, s.vat_percent, s.vat_exempt,
            ${PRICE_SQL.replace('$BRANCH', 'NULL')} AS price
       FROM services s WHERE s.tenant_id = $1 ${lock ? 'FOR UPDATE OF s' : ''}`, [tenantId])).rows;
  return rows.map((r) => ({ ...r, price: r.price == null ? null : Number(r.price) }));
}

/** Writes a plan: new services + their general price, attribute updates, new general prices (valid from now). */
export async function applyPlan(c: PoolClient, tenantId: string, plan: Plan) {
  if (plan.creates.length) {
    const made = (await c.query(
      `INSERT INTO services (id, tenant_id, code, name, category, duration_min, share_percent, active, ikpu_code, vat_percent, vat_exempt, created_at, updated_at)
       SELECT gen_random_uuid(), $1, x.code, x.name, x.category, x.duration_min, 0, true, x.ikpu_code, x.vat_percent, x.vat_exempt, demo_now(), demo_now()
         FROM jsonb_to_recordset($2::jsonb) AS x(code text, name text, category text, duration_min int, ikpu_code text, vat_percent int, vat_exempt boolean)
       RETURNING id, code`, [tenantId, JSON.stringify(plan.creates)])).rows as { id: string; code: string }[];
    const idOf = new Map(made.map((m) => [m.code, m.id]));
    await c.query(
      `INSERT INTO service_prices (tenant_id, service_id, branch_id, amount, valid_from)
       SELECT $1, x.id, NULL, x.amount, demo_now() FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, amount bigint)`,
      [tenantId, JSON.stringify(plan.creates.map((s) => ({ id: idOf.get(s.code), amount: s.price })))]);
  }
  const attrs = plan.updates.filter((u) => u.attrs);
  if (attrs.length) await c.query(
    `UPDATE services s SET category = x.category, duration_min = x.duration_min, ikpu_code = x.ikpu_code, vat_percent = x.vat_percent, vat_exempt = x.vat_exempt, updated_at = demo_now()
       FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, category text, duration_min int, ikpu_code text, vat_percent int, vat_exempt boolean)
      WHERE s.id = x.id AND s.tenant_id = $1`, [tenantId, JSON.stringify(attrs)]);
  const prices = plan.updates.filter((u) => u.price !== null);
  // new price applies to future orders; existing orders keep their price snapshot
  if (prices.length) await c.query(
    `INSERT INTO service_prices (tenant_id, service_id, branch_id, amount, valid_from)
     SELECT $1, s.id, NULL, x.price, demo_now() FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, price bigint) JOIN services s ON s.id = x.id AND s.tenant_id = $1`,
    [tenantId, JSON.stringify(prices.map((u) => ({ id: u.id, price: u.price })))]);
}
