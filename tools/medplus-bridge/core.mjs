// MedPlus bridge — the part that needs no database driver (unit-tested with a fake source, docs/MEDPLUS_SYNC.md).
// It reads MedPlus READ-ONLY through queries the clinic's admin writes in queries.json, maps columns to the batch
// protocol, sends batches over HTTPS with retry/backoff and keeps a local cursor per kind. It never writes to MedPlus
// and never logs a row's contents — only kinds, counts, cursors (ids/timestamps) and server error codes.
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, statSync } from 'node:fs';

/** Kinds in dependency order: a patient goes before its visit, a visit before its services, services before payments. */
export const KINDS = ['branch', 'staff', 'method', 'doctor', 'service', 'patient', 'visit', 'order', 'payment', 'refund', 'daily_totals'];

const FORBIDDEN = /\b(insert|update|delete|replace|alter|drop|create|truncate|grant|revoke|lock|unlock|call|set|load|handler|rename|outfile|dumpfile|sleep|benchmark|for\s+update|share\s+mode)\b/i;

/** A query may only read: one SELECT (or WITH … SELECT), no second statement, no locking read, and a :limit. */
export function checkSql(kind, sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error(`${kind}: sql bo‘sh`);
  const s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(--|#)[^\n]*/g, ' ').replace(/'(?:[^'\\]|\\.)*'/g, "''").trim();
  if (!/^(select|with)\b/i.test(s)) throw new Error(`${kind}: faqat SELECT so‘rovi bo‘lishi mumkin`);
  if (/;\s*\S/.test(s)) throw new Error(`${kind}: bitta so‘rovdan ko‘p`);
  if (FORBIDDEN.test(s)) throw new Error(`${kind}: so‘rovda taqiqlangan so‘z bor (faqat o‘qish)`);
  if (!/:limit\b/.test(s)) throw new Error(`${kind}: so‘rovda :limit bo‘lishi shart (LIMIT :limit)`);
  return true;
}

/** «:name» parameters → «?» placeholders in order (a parameter may repeat). Unknown names are an error. */
export function bindSql(sql, params) {
  const values = [];
  const text = sql.replace(/(?<![:\w]):([a-z_][a-z0-9_]*)\b/gi, (_, name) => {
    if (!(name in params)) throw new Error(`noma’lum parametr :${name}`);
    values.push(params[name]);
    return '?';
  });
  return { text, values };
}

/** Validates queries.json: { kind: { sql, cursor: [cols], start?: {col: value}, map: {field: column}, money?: [fields], deleted?, updated_at? } }. */
export function loadQueries(obj) {
  const out = {};
  for (const [kind, q] of Object.entries(obj ?? {})) {
    if (kind.startsWith('_')) continue; // comments
    if (!KINDS.includes(kind)) throw new Error(`queries.json: noma’lum tur «${kind}»`);
    checkSql(kind, q.sql);
    if (!Array.isArray(q.cursor) || !q.cursor.length || !q.cursor.every((c) => /^[a-z_][a-z0-9_]*$/i.test(c))) throw new Error(`${kind}: cursor ustunlari ro‘yxati kerak`);
    if (!q.map || typeof q.map !== 'object' || !q.map.external_id) throw new Error(`${kind}: map.external_id kerak`);
    for (const c of q.cursor) if (!new RegExp(`:last_${c}\\b`).test(q.sql)) throw new Error(`${kind}: so‘rovda :last_${c} bo‘lishi shart`);
    out[kind] = { sql: q.sql, cursor: q.cursor, start: q.start ?? {}, map: q.map, money: q.money ?? [], deleted: q.deleted ?? null, updated_at: q.updated_at ?? null };
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
/** A driver Date (a DATETIME read as local time) → «YYYY-MM-DD HH:MM:SS» wall time; strings pass as they are. */
const plain = (v) => {
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return v;
};
/** so‘m (MedPlus) → tiyin (integer): «125000.50» → 12500050. */
export const somToTiyin = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/** One row → one protocol record. Returns null when the row has no external id (counted as skipped, never sent). */
export function mapRow(kind, q, row) {
  const ext = row[q.map.external_id];
  if (ext == null || String(ext).trim() === '') return null;
  const data = {};
  for (const [field, col] of Object.entries(q.map)) {
    if (field === 'external_id') continue;
    let v = plain(row[col]);
    if (q.money.includes(field)) v = somToTiyin(v);
    if (v !== undefined) data[field] = v;
  }
  const rec = { kind, external_id: String(plain(ext)).trim(), data };
  if (q.updated_at && row[q.updated_at] != null) rec.updated_at = String(plain(row[q.updated_at]));
  if (q.deleted && row[q.deleted] != null) rec.deleted = ['1', 'true', 'yes', 'y'].includes(String(plain(row[q.deleted])).toLowerCase());
  return rec;
}

/** The cursor after a page of rows: the last row's cursor columns. */
export function cursorAfter(q, rows, prev) {
  const last = rows[rows.length - 1];
  const next = { ...prev };
  for (const c of q.cursor) next[c] = plain(last[c]);
  return next;
}
const startCursor = (q) => Object.fromEntries(q.cursor.map((c) => [c, q.start[c] ?? (/(_at|date|time|created|updated|modified)/i.test(c) ? '1970-01-01 00:00:00' : 0)]));

/** Local cursor file, written atomically (tmp + rename) after every accepted batch. */
export function fileCursorStore(path) {
  let state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8') || '{}') : {};
  return {
    get: (kind) => state[kind],
    all: () => state,
    set(kind, cur) { state = { ...state, [kind]: cur }; writeFileSync(path + '.tmp', JSON.stringify(state, null, 1)); renameSync(path + '.tmp', path); },
  };
}
export function memoryCursorStore(init = {}) {
  let state = { ...init };
  return { get: (k) => state[k], all: () => state, set(k, c) { state = { ...state, [k]: c }; } };
}

/** A run that is still going holds the lock; a lock older than staleMs (a crashed run) is taken over. */
export function takeLock(path, staleMs = 15 * 60_000) {
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < staleMs) return null;
  writeFileSync(path, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return { release: () => { try { unlinkSync(path); } catch { /* already gone */ } } };
}

export class FatalSendError extends Error {
  constructor(status, code) { super(`server ${status} ${code}`); this.status = status; this.code = code; }
}
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs batches to Med.uz.ai. Network errors, 409 SYNC_BUSY, 429 and 5xx are retried with exponential backoff
 * (2 s, 4 s, 8 s … up to 60 s, at most `retries` times); 400/401/403/404/413/422 stop the run (fix the config).
 */
export function httpSender({ server, sourceId, token, retries = 6, baseDelayMs = 2000, fetchImpl = fetch, sleep = sleepMs, log = () => {} }) {
  const url = `${server.replace(/\/+$/, '')}/api/v1/integrations/${sourceId}/batch`;
  return async (records, cursor) => {
    for (let attempt = 0; ; attempt++) {
      let status = 0, code = 'NETWORK';
      try {
        const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ records, cursor }) });
        status = r.status;
        const j = await r.json().catch(() => null);
        if (r.ok) return j?.data ?? {};
        code = j?.error?.code ?? `HTTP_${r.status}`;
        if ([400, 401, 403, 404, 413, 422].includes(r.status)) throw new FatalSendError(r.status, code);
      } catch (e) {
        if (e instanceof FatalSendError) throw e;
        code = status ? code : `NETWORK:${e?.cause?.code ?? e?.code ?? 'error'}`;
      }
      if (attempt >= retries) throw new Error(`yuborib bo‘lmadi (${code}), ${attempt + 1} urinish`);
      const delay = Math.min(60_000, baseDelayMs * 2 ** attempt) * (0.8 + Math.random() * 0.4);
      log(`qayta urinish ${attempt + 1}/${retries}: ${code}, ${Math.round(delay / 1000)} s`);
      await sleep(delay);
    }
  };
}

/**
 * One pass over every configured kind: read up to `limit` rows after the cursor, send them, move the cursor, repeat
 * until a short page or `maxBatches`. A dry run reads and maps only (counts), sends nothing and keeps no cursor.
 * `source.fetch(kind, sql, params)` returns rows; params are the cursor as `last_<col>` and `limit`.
 */
export async function runOnce({ source, queries, send, cursors, limit = 200, maxBatches = 50, dryRun = false, log = () => {} }) {
  const summary = {};
  for (const kind of KINDS) {
    const q = queries[kind];
    if (!q) continue;
    const s = (summary[kind] = { read: 0, sent: 0, skipped: 0, created: 0, updated: 0, unchanged: 0, parked: 0, errors: 0 });
    let cur = cursors.get(kind) ?? startCursor(q);
    for (let b = 0; b < maxBatches; b++) {
      const params = { limit, ...Object.fromEntries(q.cursor.map((c) => [`last_${c}`, cur[c]])) };
      const rows = await source.fetch(kind, q.sql, params);
      if (!rows.length) break;
      s.read += rows.length;
      const records = rows.map((r) => mapRow(kind, q, r)).filter(Boolean);
      s.skipped += rows.length - records.length;
      const next = cursorAfter(q, rows, cur);
      if (!dryRun && records.length) {
        const res = await send(records, { [kind]: JSON.stringify(next) });
        s.sent += records.length;
        for (const k of ['created', 'updated', 'unchanged', 'parked', 'errors']) s[k] += Number(res?.[k] ?? 0);
      }
      if (!dryRun) cursors.set(kind, next);
      cur = next;
      if (rows.length < limit) break;
    }
    log(`${kind}: o‘qildi ${s.read}${dryRun ? '' : `, yuborildi ${s.sent} (yangi ${s.created}, yangilangan ${s.updated}, kutmoqda ${s.parked}, xato ${s.errors})`}`);
  }
  return summary;
}
