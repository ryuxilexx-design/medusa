// Bridge core without MySQL: a fake MedPlus source and a fake sender (docs/MEDPLUS_SYNC.md).
// Run: node --test tools/medplus-bridge/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindSql, checkSql, fileCursorStore, httpSender, loadQueries, mapRow, memoryCursorStore, runOnce, somToTiyin, takeLock, FatalSendError } from '../core.mjs';

const QUERIES = {
  _: 'comment',
  patient: { sql: 'SELECT * FROM patients WHERE (updated_at > :last_updated_at OR (updated_at = :last_updated_at AND id > :last_id)) ORDER BY updated_at, id LIMIT :limit', cursor: ['updated_at', 'id'], updated_at: 'updated_at', map: { external_id: 'id', full_name: 'fio', birth_date: 'bday', phone: 'mobile' } },
  payment: { sql: 'SELECT * FROM kassa WHERE id > :last_id ORDER BY id LIMIT :limit', cursor: ['id'], money: ['amount'], map: { external_id: 'id', patient_id: 'pid', amount: 'summa', method: 'pay', paid_at: 'dt' } },
};

/** A fake MedPlus: tables as arrays; it understands exactly the two queries above (cursor > last, ORDER, LIMIT). */
function fakeSource(tables) {
  const calls = [];
  return {
    calls,
    async fetch(kind, sql, params) {
      calls.push({ kind, params });
      if (kind === 'patient') return tables.patients.filter((r) => r.updated_at > params.last_updated_at || (r.updated_at === params.last_updated_at && r.id > params.last_id))
        .sort((a, b) => (a.updated_at === b.updated_at ? a.id - b.id : a.updated_at < b.updated_at ? -1 : 1)).slice(0, params.limit);
      return tables.kassa.filter((r) => r.id > params.last_id).sort((a, b) => a.id - b.id).slice(0, params.limit);
    },
  };
}
const patients = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, fio: `Familiya${i} Ism${i}`, bday: '1990-01-0' + ((i % 9) + 1), mobile: '+998901234567', updated_at: `2026-10-1${i < 4 ? 0 : 1} 10:00:00` }));
const kassa = [{ id: 10, pid: 1, summa: '125000.50', pay: 'Наличными', dt: '2026-10-17 10:00:00' }, { id: 11, pid: 2, summa: '-5000', pay: 'Терминал', dt: '2026-10-17 11:00:00' }];

test('so‘rov tekshiruvi: faqat SELECT, bitta so‘rov, :limit majburiy, yozish so‘zlari taqiqlangan', () => {
  assert.ok(checkSql('x', 'SELECT id FROM t WHERE id > :last_id ORDER BY id LIMIT :limit'));
  assert.ok(checkSql('x', '/* c */ WITH a AS (SELECT 1) SELECT * FROM a LIMIT :limit'));
  assert.throws(() => checkSql('x', 'UPDATE t SET a = 1 LIMIT :limit'), /SELECT/);
  assert.throws(() => checkSql('x', 'SELECT 1 LIMIT :limit; DROP TABLE t'), /bitta/);
  assert.throws(() => checkSql('x', 'SELECT * FROM t LIMIT :limit FOR UPDATE'), /taqiqlangan/);
  assert.throws(() => checkSql('x', 'SELECT * FROM t INTO OUTFILE "/tmp/x" LIMIT :limit'), /taqiqlangan/);
  assert.throws(() => checkSql('x', 'SELECT * FROM t'), /:limit/);
  assert.ok(checkSql('x', "SELECT updated_at, created, deleted, is_delete FROM t WHERE note <> 'drop table' LIMIT :limit"), 'ustun nomlari va satrdagi so‘zlar xalaqit bermaydi');
});

test('parametrlar: :name → ? tartib bilan, takrorlansa ham; noma’lumi xato', () => {
  const { text, values } = bindSql('SELECT * FROM t WHERE (u > :last_u OR (u = :last_u AND id > :last_id)) LIMIT :limit', { last_u: 'A', last_id: 5, limit: 10 });
  assert.equal(text, 'SELECT * FROM t WHERE (u > ? OR (u = ? AND id > ?)) LIMIT ?');
  assert.deepEqual(values, ['A', 'A', 5, 10]);
  assert.throws(() => bindSql('SELECT :x LIMIT :limit', { limit: 1 }), /:x/);
  assert.equal(bindSql("SELECT '10:00:00', a::int LIMIT :limit", { limit: 1 }).values.length, 1, 'vaqt va :: cast parametr emas');
});

test('queries.json: tur, cursor va map tekshiriladi; «_» izoh kalitlari o‘tkaziladi', () => {
  const q = loadQueries(QUERIES);
  assert.deepEqual(Object.keys(q), ['patient', 'payment']);
  assert.throws(() => loadQueries({ nope: QUERIES.payment }), /noma’lum tur/);
  assert.throws(() => loadQueries({ payment: { ...QUERIES.payment, cursor: [] } }), /cursor/);
  assert.throws(() => loadQueries({ payment: { ...QUERIES.payment, map: {} } }), /external_id/);
  assert.throws(() => loadQueries({ payment: { ...QUERIES.payment, cursor: ['created'] } }), /:last_created/);
});

test('qator → yozuv: so‘m → tiyin, sana Date → devor vaqti, ID yo‘q qator tashlanadi', () => {
  const q = loadQueries(QUERIES);
  assert.equal(somToTiyin('125000.50'), 12500050);
  assert.equal(somToTiyin('1 250 000,5'), 125000050);
  assert.equal(somToTiyin(''), null);
  const r = mapRow('payment', q.payment, { id: 10, pid: 1, summa: '125000.50', pay: 'Наличными', dt: new Date(2026, 9, 17, 10, 5, 0) });
  assert.deepEqual(r, { kind: 'payment', external_id: '10', data: { patient_id: 1, amount: 12500050, method: 'Наличными', paid_at: '2026-10-17 10:05:00' } });
  assert.equal(mapRow('payment', q.payment, { id: null, summa: 1 }), null);
  const p = mapRow('patient', q.patient, patients[0]);
  assert.equal(p.updated_at, '2026-10-10 10:00:00');
});

test('o‘tish: sahifalab o‘qiydi, har paketdan keyin cursor saqlanadi, ikkinchi o‘tish faqat yangisini oladi', async () => {
  const src = fakeSource({ patients: [...patients], kassa: [...kassa] });
  const sent = [];
  const send = async (records, cursor) => { sent.push({ records, cursor }); return { created: records.length, updated: 0, unchanged: 0, parked: 0, errors: 0 }; };
  const cursors = memoryCursorStore();
  const s1 = await runOnce({ source: src, queries: loadQueries(QUERIES), send, cursors, limit: 3 });
  assert.equal(s1.patient.read, 7); assert.equal(s1.patient.sent, 7); assert.equal(s1.payment.sent, 2);
  assert.equal(sent.filter((b) => b.records[0].kind === 'patient').length, 3, '3 + 3 + 1');
  assert.ok(sent.every((b) => b.records.length <= 3));
  assert.deepEqual(cursors.get('patient'), { updated_at: '2026-10-11 10:00:00', id: 7 });
  assert.deepEqual(cursors.get('payment'), { id: 11 });
  assert.equal(sent.find((b) => b.records[0].kind === 'payment').records[1].data.amount, -500000, 'manfiy (qaytarish) qatori ham tiyinda');
  // nothing new: no batch; a new row: only it
  sent.length = 0;
  await runOnce({ source: src, queries: loadQueries(QUERIES), send, cursors, limit: 3 });
  assert.equal(sent.length, 0);
  src.calls.length = 0;
  const src2 = fakeSource({ patients: [...patients, { id: 8, fio: 'Yangi Bemor', bday: '2000-01-01', mobile: null, updated_at: '2026-10-12 09:00:00' }], kassa });
  await runOnce({ source: src2, queries: loadQueries(QUERIES), send, cursors, limit: 3 });
  assert.equal(sent.length, 1); assert.equal(sent[0].records[0].external_id, '8');
});

test('quruq o‘tish (--dry-run): faqat sanaydi, yubormaydi, cursor saqlamaydi', async () => {
  const cursors = memoryCursorStore();
  let calls = 0;
  const s = await runOnce({ source: fakeSource({ patients, kassa }), queries: loadQueries(QUERIES), send: async () => { calls++; }, cursors, limit: 5, dryRun: true });
  assert.equal(s.patient.read, 7); assert.equal(calls, 0); assert.deepEqual(cursors.all(), {});
});

test('yuborish xato bersa cursor siljimaydi (keyingi o‘tish shu joydan davom etadi)', async () => {
  const cursors = memoryCursorStore();
  let n = 0;
  const send = async (records) => { if (++n === 2) throw new Error('tarmoq'); return { created: records.length }; };
  await assert.rejects(runOnce({ source: fakeSource({ patients, kassa }), queries: loadQueries(QUERIES), send, cursors, limit: 3 }), /tarmoq/);
  assert.deepEqual(cursors.get('patient'), { updated_at: '2026-10-10 10:00:00', id: 3 }, 'faqat qabul qilingan birinchi paket');
});

test('HTTP: 5xx/409/429 va tarmoq xatosi qayta uriniladi (backoff), 401 darhol to‘xtaydi', async () => {
  const waits = [];
  const replies = [{ status: 503 }, { status: 409, body: { error: { code: 'SYNC_BUSY' } } }, null, { status: 200, body: { data: { created: 1 } } }];
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    const r = replies.shift();
    if (!r) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return { ok: r.status < 300, status: r.status, json: async () => r.body ?? {} };
  };
  const send = httpSender({ server: 'https://x.uz/', sourceId: 'S', token: 'mps_t', fetchImpl, sleep: async (ms) => { waits.push(ms); }, baseDelayMs: 1000 });
  const res = await send([{ kind: 'patient', external_id: '1', data: {} }], { patient: '{}' });
  assert.deepEqual(res, { created: 1 });
  assert.equal(seen[0].url, 'https://x.uz/api/v1/integrations/S/batch');
  assert.equal(seen[0].auth, 'Bearer mps_t');
  assert.equal(waits.length, 3);
  assert.ok(waits[0] >= 800 && waits[0] <= 1200 && waits[2] >= 3200, `backoff o‘sadi: ${waits}`);
  const bad = httpSender({ server: 'https://x.uz', sourceId: 'S', token: 't', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 'UNAUTHENTICATED' } }) }), sleep: async () => {} });
  await assert.rejects(bad([]), (e) => e instanceof FatalSendError && e.status === 401);
  const down = httpSender({ server: 'https://x.uz', sourceId: 'S', token: 't', retries: 2, fetchImpl: async () => { throw new Error('down'); }, sleep: async () => {} });
  await assert.rejects(down([]), /3 urinish/);
});

test('cursor fayli va qulf: atomar yozuv, ikkinchi nusxa ishlamaydi', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-bridge-'));
  const store = fileCursorStore(join(dir, 'cursor.json'));
  store.set('payment', { id: 11 });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'cursor.json'), 'utf8')), { payment: { id: 11 } });
  assert.ok(!existsSync(join(dir, 'cursor.json.tmp')));
  assert.deepEqual(fileCursorStore(join(dir, 'cursor.json')).get('payment'), { id: 11 });
  const a = takeLock(join(dir, 'bridge.lock'));
  assert.ok(a); assert.equal(takeLock(join(dir, 'bridge.lock')), null);
  a.release(); assert.ok(takeLock(join(dir, 'bridge.lock')));
});
