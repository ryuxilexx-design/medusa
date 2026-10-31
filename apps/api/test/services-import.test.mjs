// Price-list import (docs/PRICE_LIST_IMPORT.md): manager only, tenant-isolated, preview stores nothing, new / price
// changed / other fields / unchanged / error per row, so‘m → tiyin, code before name, the mirror's «MedPlus: …»
// placeholder is never the real service, a re-import is a no-op, past orders keep their price, size/row limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const { buildXlsx } = require('../dist/core/xlsx.js');
const { somToTiyin, categoryFromText, guessPriceMapping } = require('../dist/modules/price-import.js');
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const isForm = body instanceof FormData;
    const r = await fetch(base + path, { method, headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), cookie }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t };
  };
  return { get: (p) => req('GET', p), post: (p, b) => req('POST', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const form = (buf, fields = {}, name = 'prays.xlsx') => { const f = new FormData(); f.append('file', new Blob([buf]), name); for (const [k, v] of Object.entries(fields)) f.append(k, typeof v === 'string' ? v : JSON.stringify(v)); return f; };
/** A MedPlus-like export: a title row, then the header. */
const sheet = (header, rows) => buildXlsx(['Прейскурант клиники Planbaby'], [[], header, ...rows]);
const counts = async () => ({
  services: (await one(`SELECT count(*)::int AS n FROM services`)).n,
  prices: (await one(`SELECT count(*)::int AS n FROM service_prices`)).n,
  audit: (await one(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'service.import'`)).n,
});
const T1 = SEED_IDS.tenant;
const svcByName = (name, tenant = T1) => one(`SELECT s.*, (SELECT amount FROM service_prices sp WHERE sp.service_id = s.id AND sp.branch_id IS NULL ORDER BY valid_from DESC, created_at DESC LIMIT 1)::bigint AS price
  FROM services s WHERE s.tenant_id = $1 AND lower(s.name) = lower($2)`, [tenant, name]);

let manager, t2manager, others;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset', {})).status, 200);
  t2manager = session(); await t2manager.demo(M.tenant2Manager);
  others = [];
  for (const m of [M.cashier, M.registrar, M.doctor(1), M.lab, M.storekeeper, M.guard]) { const s = session(); assert.equal((await s.demo(m)).status, 200); others.push(s); }
});
after(async () => {
  // leave the seed as the other test files expect it
  await manager?.post('/demo/reset', {});
  await app?.close();
});

const HEADER = ['Код', 'Наименование услуги', 'Категория', 'Цена, сум', 'ИКПУ', 'НДС', 'Длительность'];
const ROWS = [
  ['C01', 'Terapevt konsultatsiyasi', 'Консультация', '150 000,00', null, null, null], //   4 unchanged (seed 150 000)
  [null, 'KARDIOLOG konsultatsiyasi', null, '250000', null, null, null], //                 5 price changed, by name
  ['C05', 'Nevropatolog (eski nom)', null, 200000, null, null, null], //                    6 unchanged, by code
  [null, 'УЗИ щитовидной железы', 'УЗИ', '180 000', '12345678901234567', '12%', '20'], //   7 new ultrasound
  [null, 'Анализ на ферритин (новый)', null, 95000.5, null, null, null], //                8 new, lab guessed from the name
  [null, 'Yomon narx', null, 'abc', null, null, null], //                                   9 error: price
  [null, 'Manfiy narx', null, '-5 000', null, null, null], //                               10 error: negative
  [null, 'Kardiolog konsultatsiyasi', null, '1', null, null, null], //                     11 error: duplicate
  ['X-77', 'Massaj (umumiy)', 'Процедуры', '1.250.000', null, null, null], //              12 new, file code
  [null, 'Gastroskopiya', null, '300 000', null, null, null], //                           13 new (the placeholder is not it)
  ['C06', 'Pediatr konsultatsiyasi', null, '160 000', null, 'Без НДС', null], //           14 updated: VAT only
  [null, 'Yomon IKPU', null, '10 000', '123', null, null], //                              15 error: IKPU
  [null, '', null, null, null, null, null], //                                                 empty row: skipped
];

test('so‘m → tiyin, kategoriya va sarlavhalar (sof funksiyalar)', () => {
  assert.equal(somToTiyin('150 000,00'), 15_000_000);
  assert.equal(somToTiyin('150 000'), 15_000_000);
  assert.equal(somToTiyin('150000.5'), 15_000_050);
  assert.equal(somToTiyin('150,000.00'), 15_000_000);
  assert.equal(somToTiyin('1.250.000'), 125_000_000);
  assert.equal(somToTiyin('1 250 000 сум'), 125_000_000);
  assert.equal(somToTiyin(95000.5), 9_500_050);
  assert.equal(somToTiyin('-5 000'), -500_000);
  assert.equal(somToTiyin('150.000'), null, 'bitta ajratkich + 3 raqam: noaniq');
  assert.equal(somToTiyin('abc'), null);
  assert.equal(categoryFromText('УЗИ'), 'ultrasound');
  assert.equal(categoryFromText('Лабораторные анализы'), 'lab');
  assert.equal(categoryFromText('Гинекология'), null, 'bo‘lim nomi — kategoriya emas');
  assert.deepEqual(guessPriceMapping(HEADER), { code: 0, name: 1, category: 2, price: 3, ikpu: 4, vat: 5, duration: 6 });
  assert.deepEqual(guessPriceMapping(['№', 'Xizmat', 'Narx', 'Bo‘lim']), { name: 1, price: 2, category: 3 });
});

test('faqat rahbar: boshqa rollar 403, kirmagan 401', async () => {
  const file = sheet(HEADER, ROWS.slice(0, 2));
  for (const who of others) {
    assert.equal((await who.post('/services/import/preview', form(file))).status, 403);
    assert.equal((await who.post('/services/import', form(file, { mapping: { name: 1, price: 3 } }))).status, 403);
  }
  assert.equal((await fetch(`${base}/services/import/preview`, { method: 'POST', body: form(file) })).status, 401);
});

let placeholderId;
test('ko‘rib chiqish: ustunlar taxmini va har qator natijasi; hech narsa yozilmaydi', async () => {
  // the mirror's placeholder for an unmapped MedPlus service with the same name
  placeholderId = (await one(`INSERT INTO services (id, tenant_id, code, name, category, duration_min, share_percent, active) VALUES (gen_random_uuid(), $1, 'MP-TEST000001', 'MedPlus: Gastroskopiya', 'procedure', 15, 0, false) RETURNING id`, [T1])).id;
  const before = await counts();
  const r = await manager.post('/services/import/preview', form(sheet(HEADER, ROWS)));
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.header_row, 3, 'sarlavha qatori sarlavha-izohdan keyin');
  assert.deepEqual(d.guess, { code: 0, name: 1, category: 2, price: 3, ikpu: 4, vat: 5, duration: 6 });
  assert.deepEqual(d.counts, { total: 12, created: 4, price_changed: 1, updated: 1, unchanged: 2, error: 4 });
  const at = (row) => d.rows.find((x) => x.row === row);
  assert.equal(at(4).outcome, 'unchanged');
  assert.deepEqual([at(5).outcome, at(5).matched_by, at(5).old_price, at(5).price], ['price_changed', 'name', 22_000_000, 25_000_000]);
  assert.deepEqual([at(6).outcome, at(6).matched_by, at(6).name], ['unchanged', 'code', 'Nevrolog konsultatsiyasi']);
  assert.deepEqual([at(7).outcome, at(8).outcome, at(12).outcome, at(12).code, at(13).outcome], ['created', 'created', 'created', 'X-77', 'created']);
  assert.match(at(7).code, /^U\d{2}$/); assert.match(at(8).code, /^L\d{2}$/);
  assert.deepEqual(at(14).changes, ['vat']);
  assert.deepEqual(d.errors.map((e) => [e.row, e.error]), [[9, 'price_bad'], [10, 'price_negative'], [11, 'duplicate'], [15, 'ikpu']]);
  assert.deepEqual(await counts(), before, 'ko‘rib chiqish hech narsa yozmaydi');
  // the user's own mapping: the price column left out → 422, the fields name it
  const bad = await manager.post('/services/import/preview', form(sheet(HEADER, ROWS), { mapping: { name: 1, price: -1 } }));
  assert.equal(bad.status, 422); assert.ok(bad.body.error.fields.price);
  assert.equal((await manager.post('/services/import/preview', form(sheet(HEADER, ROWS), { mapping: { name: 1, price: 99 } }))).status, 422, 'jadvaldan tashqari ustun');
  // unknown headers: the preview still answers with the columns, the person picks name and price
  const unknown = await manager.post('/services/import/preview', form(buildXlsx(['A', 'B'], [['Massaj', '100 000']])));
  assert.equal(unknown.status, 200, unknown.text);
  assert.deepEqual([unknown.body.data.missing, unknown.body.data.counts, unknown.body.data.headers], [['name', 'price'], null, ['A', 'B']]);
  const picked = await manager.post('/services/import/preview', form(buildXlsx(['A', 'B'], [['Massaj', '100 000']]), { mapping: { name: 0, price: 1 } }));
  assert.equal(picked.body.data.counts.created, 1);
});

test('yuklash: bitta tranzaksiyada qo‘llanadi, xato qatorlar o‘tkaziladi, eski buyurtma narxi o‘zgarmaydi, audit faqat sonlar', async () => {
  const kard = await svcByName('Kardiolog konsultatsiyasi');
  const order = await one(`SELECT id, price_snapshot FROM service_orders WHERE service_id = $1 ORDER BY ordered_at LIMIT 1`, [kard.id]);
  assert.ok(order, 'seed: kardiolog buyurtmasi');
  const before = await counts();
  assert.equal((await manager.post('/services/import', form(sheet(HEADER, ROWS)))).status, 422, 'tasdiqlangan ustunlarsiz — yo‘q');
  const mapping = { code: 0, name: 1, category: 2, price: 3, ikpu: 4, vat: 5, duration: 6 };
  const r = await manager.post('/services/import', form(sheet(HEADER, ROWS), { mapping }));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data.counts, { total: 12, created: 4, price_changed: 1, updated: 1, unchanged: 2, error: 4 });
  const after = await counts();
  assert.equal(after.services - before.services, 4);
  assert.equal(after.prices - before.prices, 5, '4 yangi + 1 narx o‘zgarishi');
  assert.equal(after.audit - before.audit, 1);
  assert.equal(Number((await svcByName('Kardiolog konsultatsiyasi')).price), 25_000_000);
  assert.equal(Number((await one(`SELECT price_snapshot FROM service_orders WHERE id = $1`, [order.id])).price_snapshot), Number(order.price_snapshot), 'eski buyurtma narxi o‘z holida');
  const uzi = await svcByName('УЗИ щитовидной железы');
  assert.deepEqual([uzi.category, uzi.active, uzi.ikpu_code, uzi.vat_percent, uzi.vat_exempt, uzi.duration_min, Number(uzi.price)], ['ultrasound', true, '12345678901234567', 12, false, 20, 18_000_000]);
  const fer = await svcByName('Анализ на ферритин (новый)');
  assert.deepEqual([fer.category, fer.duration_min, Number(fer.price)], ['lab', 15, 9_500_050]);
  const mas = await svcByName('Massaj (umumiy)');
  assert.deepEqual([mas.code, mas.category, Number(mas.price)], ['X-77', 'procedure', 125_000_000]);
  const gas = await svcByName('Gastroskopiya');
  assert.ok(gas.active && gas.id !== placeholderId, 'haqiqiy xizmat yaratildi');
  const ph = await one(`SELECT active, name FROM services WHERE id = $1`, [placeholderId]);
  assert.deepEqual([ph.active, ph.name], [false, 'MedPlus: Gastroskopiya'], 'joy egasiga tegilmadi');
  const ped = await svcByName('Pediatr konsultatsiyasi');
  assert.deepEqual([ped.vat_exempt, Number(ped.price)], [true, 16_000_000]);
  assert.equal((await svcByName('Nevrolog konsultatsiyasi')).name, 'Nevrolog konsultatsiyasi', 'kod bo‘yicha topilganda nomi o‘zgarmaydi');
  assert.equal(await svcByName('Yomon narx'), undefined);
  const a = await one(`SELECT summary, actor_role FROM audit_logs WHERE action = 'service.import' ORDER BY occurred_at DESC LIMIT 1`);
  assert.equal(a.actor_role, 'manager');
  assert.match(a.summary, /4 yangi, 1 narx o‘zgardi, 1 boshqa maydon, 2 o‘zgarishsiz, 4 xato/);
  assert.doesNotMatch(a.summary, /Kardiolog|УЗИ|Gastroskopiya/, 'auditda xizmat nomlari yo‘q');
  // the catalogue API shows the new price
  const list = (await manager.get('/services?active=all')).body.data;
  assert.equal(Number(list.find((s) => s.id === kard.id).price), 25_000_000);
});

test('qayta yuklash — hech narsa o‘zgarmaydi', async () => {
  const before = await counts();
  const r = await manager.post('/services/import', form(sheet(HEADER, ROWS), { mapping: { code: 0, name: 1, category: 2, price: 3, ikpu: 4, vat: 5, duration: 6 } }));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data.counts, { total: 12, created: 0, price_changed: 0, updated: 0, unchanged: 8, error: 4 });
  const after = await counts();
  assert.deepEqual([after.services, after.prices], [before.services, before.prices]);
});

test('boshqa klinika: o‘z katalogi; birinchi klinika xizmatlariga tegmaydi', async () => {
  const t1 = await svcByName('Terapevt konsultatsiyasi');
  const file = sheet(['Xizmat', 'Narx'], [['Terapevt konsultatsiyasi', '1'], ['УЗИ щитовидной железы', '5 000']]);
  const pv = (await t2manager.post('/services/import/preview', form(file))).body.data;
  assert.equal(pv.counts.created + pv.counts.price_changed + pv.counts.unchanged, 2);
  assert.ok(pv.rows.every((x) => x.outcome !== 'unchanged' || x.name !== 'УЗИ щитовидной железы'), '1-klinika xizmati ko‘rinmaydi');
  const r = await t2manager.post('/services/import', form(file, { mapping: pv.mapping }));
  assert.equal(r.status, 200, r.text);
  assert.equal(Number((await svcByName('Terapevt konsultatsiyasi')).price), Number(t1.price), '1-klinika narxi o‘zgarmadi');
  const t2 = (await one(`SELECT tenant_id FROM memberships WHERE id = $1`, [M.tenant2Manager])).tenant_id;
  assert.equal(Number((await svcByName('УЗИ щитовидной железы', t2)).price), 500_000);
  assert.ok(r.body.data.rows.every((x) => !x.service_id || x.service_id !== t1.id));
});

/** Windows-1251 bytes for a Russian Excel «CSV (разделители — точка с запятой)». */
const cp1251 = (s) => Buffer.from([...s].map((ch) => {
  const c = ch.codePointAt(0);
  if (c < 128) return c;
  if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
  if (c === 0x401) return 0xa8; if (c === 0x451) return 0xb8;
  throw new Error('cp1251: ' + ch);
}));

test('CSV (UTF-8 va Windows-1251) va HTML-jadval .xls ham o‘qiladi', async () => {
  const csv = 'Наименование;Цена;Отделение\r\nТерапевт консультация (CSV);"150 000,00";Консультация\r\n';
  for (const buf of [Buffer.from(csv, 'utf8'), cp1251(csv)]) {
    const r = await manager.post('/services/import/preview', form(buf, {}, 'prays.csv'));
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.data.guess, { name: 0, price: 1, category: 2 });
    assert.deepEqual([r.body.data.counts.created, r.body.data.rows[0].name, r.body.data.rows[0].price], [1, 'Терапевт консультация (CSV)', 15_000_000]);
  }
  const html = '<html><body><table><tr><th>Услуга</th><th>Стоимость</th></tr><tr><td>Qorin bo‘shlig‘i UZI</td><td>180 000</td></tr></table></body></html>';
  const h = await manager.post('/services/import/preview', form(Buffer.from(html), {}, 'prays.xls'));
  assert.equal(h.status, 200, h.text);
  assert.equal(h.body.data.rows[0].outcome, 'unchanged');
  assert.equal((await manager.post('/services/import/preview', form(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), {}, 'old.xls'))).body.error.code, 'XLS_OLD');
  assert.equal((await manager.post('/services/import/preview', new FormData())).status, 422, 'faylsiz');
});

test('cheklovlar: 5000 qatordan ko‘p — 413, 10 MB dan katta — 413, hech narsa yozilmaydi', async () => {
  const before = await counts();
  const many = sheet(['Xizmat', 'Narx'], Array.from({ length: 5001 }, (_, i) => [`Xizmat ${i}`, 1000]));
  const r = await manager.post('/services/import', form(many, { mapping: { name: 0, price: 1 } }));
  assert.deepEqual([r.status, r.body.error.code], [413, 'TOO_MANY_ROWS']);
  const ok = await manager.post('/services/import/preview', form(sheet(['Xizmat', 'Narx'], Array.from({ length: 5000 }, (_, i) => [`Xizmat ${i}`, 1000]))));
  assert.equal(ok.status, 200, '5000 — mumkin');
  assert.equal(ok.body.data.rows.length, 50, 'javobda birinchi 50 qator');
  const big = await manager.post('/services/import/preview', form(Buffer.alloc(10 * 1024 * 1024 + 10, 0x41), {}, 'big.csv'));
  assert.deepEqual([big.status, big.body.error.code], [413, 'FILE_TOO_LARGE']);
  assert.deepEqual(await counts(), before);
});
