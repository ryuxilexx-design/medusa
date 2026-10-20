// Patient consent (ZRU-547) in the browser: amber notice on a card without consent, recording it, the consent block
// with status + history, the printable A4 form (Uzbek and Russian) and the consent fields of the new-patient form.
import { launch, newPage, login, shot, settle, clickText, waitText, sleep, check, BASE, SHOTS } from './lib.mjs';
const errors = [];
const b = await launch();
try {
  const r = await newPage(b, errors);
  await login(r, 'Registrator');
  // seed: patients #…7, #…8, #…9 have no consent form yet
  const p = await r.evaluate(async () => (await (await fetch('/api/v1/patients?search=1008')).json()).data[0]);
  await r.goto(`${BASE}/patients/${p.id}`, { waitUntil: 'networkidle0' }); await settle(r);
  await waitText(r, 'Bemorning roziligi qayd etilmagan');
  check(await r.evaluate(() => !!document.querySelector('[data-testid="consent-notice"]')), 'Roziliksiz kartada sariq ogohlantirish bor');
  check(await r.evaluate(() => document.querySelector('[data-testid="consent-block"]')?.innerText.includes('Rozilik yo‘q')), 'Rozilik bloki: «Rozilik yo‘q» (so‘z + belgi)');
  await shot(r, 'consent-01-card-missing');

  // record: the modal asks for an answer first (input kept), then saves
  await clickText(r, 'Rozilikni qayd etish', '[data-testid="consent-notice"] button');
  await waitText(r, 'Bemor javobi');
  await clickText(r, 'Saqlash', '[role=dialog] button'); await sleep(200);
  check(await r.evaluate(() => document.querySelector('[role=dialog]')?.innerText.includes('Bemor javobini tanlang')), 'Javobsiz saqlanmaydi, xato ko‘rsatiladi');
  await r.evaluate(() => [...document.querySelectorAll('[role=dialog] label')].find((l) => l.textContent.trim() === 'Rozilik berdi').querySelector('input').click());
  await shot(r, 'consent-02-modal');
  await clickText(r, 'Saqlash', '[role=dialog] button'); await settle(r);
  await waitText(r, 'Rozilik qayd etildi');
  await r.waitForFunction(() => !document.querySelector('[data-testid="consent-notice"]'), { timeout: 10000 });
  const block = await r.evaluate(() => document.querySelector('[data-testid="consent-block"]').innerText);
  check(block.includes('Rozilik bor') && block.includes('Versiya 2026-10') && block.includes('Malika Yusupova'), 'Blok: «Rozilik bor», versiya, kim qayd etgani');
  // the history toggle is shown once the card has at least one consent record
  await r.waitForSelector('[data-testid="consent-block"] details', { timeout: 10000 });
  await r.evaluate(() => { const d = document.querySelector('[data-testid="consent-block"] details'); d.open = true; d.scrollIntoView({ block: 'center' }); });
  await sleep(300);
  check((await r.evaluate(() => document.querySelector('[data-testid="consent-block"] details').innerText)).includes('Tarix (1)'), 'Tarixda 1 ta yozuv');
  await shot(r, 'consent-03-card-granted');

  // printable form
  const pr = await newPage(b, errors);
  await login(pr, 'Registrator');
  await pr.goto(`${BASE}/print/consent/${p.id}`, { waitUntil: 'networkidle0' }); await settle(pr);
  await waitText(pr, 'Shaxsga doir ma’lumotlarni qayta ishlashga rozilik');
  const txt = await pr.evaluate(() => document.body.innerText);
  check(txt.includes('Med.uz.ai Demo Clinic') && txt.includes('O‘zbekiston Respublikasi hududidagi') && txt.includes('Bemor (yoki qonuniy vakili)') && txt.includes(`RZ-${p.patient_number}`), 'Chop etish: to‘liq matn, klinika, imzo joylari, bemor ID');
  await shot(pr, 'consent-04-print');
  await pr.screenshot({ path: SHOTS + 'consent-04b-print-full.png', fullPage: true });
  // what the language switcher does: saves the choice on the server and in the meduza_lang cookie (print pages read it)
  await pr.evaluate(() => fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'ru' }) }));
  await pr.setCookie({ name: 'meduza_lang', value: 'ru', url: BASE });
  await pr.goto(`${BASE}/print/consent/${p.id}`, { waitUntil: 'networkidle0' }); await settle(pr);
  await waitText(pr, 'Согласие на обработку персональных данных');
  await shot(pr, 'consent-05-print-ru');
  check(true, 'Chop etish rus tilida');
  await pr.setCookie({ name: 'meduza_lang', value: 'uz', url: BASE });
  await pr.goto(`${BASE}/print/consent/blank`, { waitUntil: 'networkidle0' }); await settle(pr);
  await waitText(pr, 'Rozilik varaqasi (bo‘sh)');
  check((await pr.evaluate(() => document.body.innerText)).includes('Huquqlaringiz'), 'Bo‘sh varaqa (karta ochilishidan oldin) chop etiladi');

  // new-patient form: consent fields (optional in the demo)
  await r.goto(BASE + '/patients', { waitUntil: 'networkidle0' });
  await clickText(r, 'Bemor qo‘shish'); await sleep(300);
  const form = await r.evaluate(() => document.querySelector('[role=dialog]').innerText);
  check(form.includes('Bemor shaxsiy ma’lumotlarni qayta ishlashga yozma rozilik berdi') && form.includes('Telegram eslatmalariga rozilik') && form.includes('Demo rejimida ixtiyoriy'), 'Bemor formasida rozilik maydonlari');
  await r.evaluate(() => document.querySelector('[role=dialog] fieldset').scrollIntoView({ block: 'center' }));
  await shot(r, 'consent-06-form');

  const unexpected = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  check(!unexpected.length, 'Konsolda kutilmagan JS xato yo‘q' + (unexpected.length ? ': ' + unexpected.join(' | ') : ''));
} finally { await b.close(); }
