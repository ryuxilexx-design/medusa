// Visit documents in the browser: issue a prescription from the visit → print page shows it → void with a reason.
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const setInput = (p, sel, v) => p.evaluate((sel, v) => {
  const el = document.querySelector(sel);
  Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, sel, v);
try {
  const d = await newPage(b, errors);
  await login(d, 'Shifokor', 'Akmal Rasulov');
  await d.goto(BASE + '/doctor', { waitUntil: 'networkidle0' }); await settle(d);
  await d.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Qabulda'))?.click()); await settle(d);
  await waitText(d, 'Hujjatlar');
  check(await d.evaluate(() => document.body.innerText.includes('Bu qabulda hujjat berilmagan')), 'Qabulda «Hujjatlar» bloki bor (hali bo‘sh)');

  await clickText(d, 'Retsept', 'button');
  await waitText(d, 'Retsept (dori tavsiyasi) berish');
  // empty prescription → server validation shown, nothing issued
  await clickText(d, 'Berish va saqlash', '[role=dialog] button');
  await waitText(d, 'Kamida bitta dori');
  check(true, 'Bo‘sh retsept berilmaydi — xato ko‘rsatildi');
  const row = { name: 'Amlodipin', form: 'tabletka', dose: '5 mg', frequency: 'kuniga 1 marta, ertalab', duration: '30 kun' };
  for (const [k, v] of Object.entries(row)) await setInput(d, `[role=dialog] input[aria-label="1-dori: ${k}"]`, v);
  await shot(d, 'doc-01-prescription-form');
  await clickText(d, 'Berish va saqlash', '[role=dialog] button');
  await waitText(d, 'berildi');
  await settle(d);
  const href = await d.evaluate(() => [...document.querySelectorAll('a[href^="/print/document/"]')].at(-1)?.getAttribute('href'));
  check(!!href && await d.evaluate(() => /Retsept \(dori tavsiyasi\) №\d+/.test(document.body.innerText)), 'Retsept ro‘yxatda raqami bilan');

  const p = await newPage(b, errors);
  await login(p, 'Shifokor', 'Akmal Rasulov');
  await p.goto(BASE + href, { waitUntil: 'networkidle0' }); await settle(p);
  await waitText(p, 'Amlodipin');
  check(await p.evaluate(() => document.body.innerText.includes('kuniga 1 marta, ertalab') && document.body.innerText.includes('DMED') && document.body.innerText.includes('R-')), 'Chop etish sahifasi: dori, tartib, raqam va «DMED emas» belgisi');
  await shot(p, 'doc-02-print');

  await clickText(d, 'Bekor qilish', 'li button');
  await waitText(d, 'ni bekor qilish');
  await setInput(d, '[role=dialog] input', 'Doza qayta ko‘rib chiqildi');
  await clickText(d, 'Bekor qilish', '[role=dialog] .justify-end button');
  await waitText(d, 'Hujjat bekor qilindi');
  await settle(d);
  check(await d.evaluate(() => document.body.innerText.includes('Bekor qilingan: Doza qayta ko‘rib chiqildi')), 'Bekor qilindi, sababi ko‘rinadi');
  await p.reload({ waitUntil: 'networkidle0' }); await settle(p);
  check(await p.evaluate(() => document.body.innerText.includes('Bekor qilingan')), 'Bosma nusxada «Bekor qilingan»');
  await shot(p, 'doc-03-print-void');
} catch (e) {
  for (const [i, pg] of (await b.pages()).entries()) await pg.screenshot({ path: new URL(`./shots/doc-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
// the one 422 is the deliberate empty-prescription check
const real = errors.filter((e) => !e.includes('status of 422'));
check(real.length === 0 && errors.length <= 1, `Brauzer xatolari yo‘q (kutilgan bitta 422 dan tashqari)${real.length ? ': ' + real.join(' | ') : ''}`);
