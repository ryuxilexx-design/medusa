// MedPlus integration in the browser (docs/MEDPLUS_SYNC.md): connecting a clinic shows the bridge key exactly once,
// the demo clinic's status and mappings, a file import (preview → check → import), the «MedPlus» badge on a mirrored
// patient (no edit button), the read-only mirrored invoice and the «Excel / CSV» export choice.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launch, newPage, login, shot, settle, clickText, waitText, sleep, check, BASE, SHOTS } from './lib.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = require('../database/dist/src/index.js');
const { buildXlsx } = require('../apps/api/dist/core/xlsx.js');
const errors = [];
const b = await launch();
const openTab = async (p, label) => { await clickText(p, label, '[role=tab]'); await settle(p); };
try {
  // ---- a clinic without MedPlus: connect, the key is shown once
  const t2 = await newPage(b, errors);
  await t2.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await t2.evaluate(async (id) => { await fetch('/api/v1/demo/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membership_id: id }) }); }, SEED_IDS.membership.tenant2Manager);
  await t2.goto(BASE + '/settings', { waitUntil: 'networkidle0' }); await settle(t2);
  await openTab(t2, 'Integratsiyalar');
  await waitText(t2, 'MedPlus ulanmagan');
  await shot(t2, 'sync-01-empty');
  await clickText(t2, 'MedPlus’ni ulash'); await sleep(300);
  await clickText(t2, 'Ulash', '[role=dialog] button'); await settle(t2);
  await waitText(t2, 'Ko‘prik kaliti');
  const shown = await t2.evaluate(() => document.querySelector('[data-testid="sync-token"]')?.value ?? '');
  check(/^mps_[A-Za-z0-9_-]{43}$/.test(shown), 'Ulanganda ko‘prik kaliti bir marta ko‘rsatiladi');
  await shot(t2, 'sync-02-token-once');
  await clickText(t2, 'Nusxaladim', '[role=dialog] button'); await settle(t2);
  const listed = await t2.evaluate(async () => JSON.stringify((await (await fetch('/api/v1/integrations/sources')).json()).data));
  check(!listed.includes(shown) && !(await t2.evaluate(() => document.body.innerText)).includes(shown), 'Kalit ro‘yxatda ham, sahifada ham boshqa ko‘rinmaydi');
  await t2.reload({ waitUntil: 'networkidle0' }); await settle(t2);
  check(!(await t2.evaluate(() => document.body.innerText)).includes('mps_'), 'Qayta ochilganda kalit yo‘q');

  // ---- the demo clinic: status, mappings, file import
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.goto(BASE + '/settings', { waitUntil: 'networkidle0' }); await settle(m);
  await openTab(m, 'Integratsiyalar');
  await waitText(m, 'MedPlus (demo)');
  const head = await m.evaluate(() => document.querySelector('main').innerText);
  check(head.includes('Ishlayapti') && head.includes('Bemorlar') && head.includes('Tashriflar'), 'Holat: ishlayapti, sanoqlar');
  await shot(m, 'sync-03-status');
  const branches = await m.evaluate(() => document.querySelector('main table')?.innerText ?? '');
  check(branches.includes('Markaziy filial') && branches.includes('Yunusobod filiali'), 'Moslashtirish: MedPlus filiallari bizning filiallarga');

  // a small MedPlus patients export (Russian headers, a title row above)
  const file = SHOTS + 'medplus-patients.xlsx';
  writeFileSync(file, buildXlsx(['Список пациентов'], [
    ['ID', 'ФИО пациента', 'Дата рож.', 'Пол', 'Мобильный телефон', 'Адрес'],
    [52001, 'Ergasheva Zarina Botirovna', '04.04.1994', 'Ж', '+998 91 204 40 04', 'Yunusobod'],
    [52002, 'Nazarov Otabek', '17.09.1986', 'М', '91 204 40 05', ''],
    [52003, 'Sanasiz Bemor', '', 'М', '', ''],
  ]));
  await openTab(m, 'Fayldan import');
  const input = await m.$('[data-testid="sync-file"]');
  await input.uploadFile(file);
  await clickText(m, 'Faylni o‘qish'); await settle(m);
  await waitText(m, 'Sarlavha qatori: 2');
  const mapped = await m.evaluate(() => [...document.querySelectorAll('main select')].map((s) => s.options[s.selectedIndex]?.text));
  check(mapped.includes('ФИО пациента') && mapped.includes('Дата рож.') && mapped.includes('ID'), 'Ustunlar MedPlus sarlavhalaridan taxmin qilindi');
  await shot(m, 'sync-04-import-columns');
  await clickText(m, 'Tekshirish'); await settle(m);
  await waitText(m, 'Tekshirildi');
  const dry = await m.evaluate(() => document.querySelector('[data-testid="sync-import-result"]').innerText);
  check(dry.includes('Yangi: 2') && dry.includes('Ustun bo‘sh: Tug‘ilgan sana'), 'Tekshiruv: 2 ta yangi, bitta qator xatosi (tug‘ilgan sana yo‘q)');
  const before = await m.evaluate(async () => (await (await fetch('/api/v1/patients?search=912044004')).json()).data.length);
  check(before === 0, 'Tekshiruv hech narsa yozmadi');
  await shot(m, 'sync-05-import-check');
  await clickText(m, 'Import qilish'); await settle(m);
  await waitText(m, 'Import tugadi');
  await shot(m, 'sync-06-import-done');
  const imported = await m.evaluate(async () => (await (await fetch('/api/v1/patients?search=912044004')).json()).data[0]);
  check(!!imported, 'Bemor import qilindi');

  // ---- the mirrored patient: badge, no edit button
  await m.goto(`${BASE}/patients/${imported.id}`, { waitUntil: 'networkidle0' }); await settle(m);
  await waitText(m, 'MedPlus #52001');
  const card = await m.evaluate(() => document.querySelector('main').innerText);
  check(!card.includes('Tahrirlash'), 'Ko‘chirilgan kartada «Tahrirlash» yo‘q');
  await shot(m, 'sync-07-patient-badge');

  // ---- a mirrored invoice: no payment form, the MedPlus note
  const inv = await m.evaluate(async () => {
    const p = (await (await fetch('/api/v1/patients?search=973001101')).json()).data[0];
    return (await (await fetch(`/api/v1/patients/${p.id}/history`)).json()).data.invoices.find((i) => i.mirrored);
  });
  await m.goto(`${BASE}/cashier/${inv.id}`, { waitUntil: 'networkidle0' }); await settle(m);
  await waitText(m, 'MedPlus’dan ko‘chirilgan');
  const buttons = await m.evaluate(() => [...document.querySelectorAll('main button')].map((x) => x.textContent.trim()));
  check(!buttons.some((x) => /Qaytarish|Chegirma|Bekor qilish|To‘lovni qabul/.test(x)), 'Ko‘chirilgan hisobda to‘lov, chegirma va qaytarish tugmalari yo‘q');
  await shot(m, 'sync-08-invoice');

  // ---- exports: Excel next to CSV
  await m.goto(`${BASE}/finance`, { waitUntil: 'networkidle0' }); await settle(m);
  const links = await m.evaluate(() => [...document.querySelectorAll('a[download]')].map((a) => a.getAttribute('href')));
  check(links.some((h) => h.includes('/payments/export.xlsx')) && links.some((h) => h.includes('/payments/export.csv')), 'Moliya: «Excel / CSV» tanlovi');
  const xlsx = await m.evaluate(async (h) => { const r = await fetch(h); return { status: r.status, type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength }; }, links.find((h) => h.includes('.xlsx')));
  check(xlsx.status === 200 && xlsx.type.includes('spreadsheetml') && xlsx.size > 1000, 'XLSX fayli yuklab olinadi');

  const unexpected = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  check(!unexpected.length, 'Konsolda kutilmagan JS xato yo‘q' + (unexpected.length ? ': ' + unexpected.join(' | ') : ''));
} finally { await b.close(); }
