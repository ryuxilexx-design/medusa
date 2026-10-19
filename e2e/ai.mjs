// AI phase 1 in the browser (sample mode, no model calls): MKB-10 search → pick → save → survives reload;
// code suggestion by word match; news card; manager's AI settings.
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, fill, BASE } from './lib.mjs';
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
  // the visit already in progress for this doctor in the seed
  await d.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Qabulda'))?.click()); await settle(d);
  await waitText(d, 'Klinik qayd');
  check(await d.evaluate(() => document.body.innerText.includes('Bugun sohangizda')), 'Shifokor sahifasida «Bugun sohangizda» bloki bor');

  await fill(d, 'Tashxis / xulosa', 'Surunkali gastrit, qo‘zish davri');
  await setInput(d, 'input[aria-label="MKB-10 qidirish"]', 'gastrit');
  await d.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
  await shot(d, 'ai-01-icd-search');
  await d.evaluate(() => [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((o) => o.textContent.includes('K29.7')).click()); await sleep(300);
  check(await d.evaluate(() => !!document.querySelector('button[aria-label="K29.7 ni olib tashlash"]')), 'K29.7 tanlandi (chip)');

  await clickText(d, 'Kod taklif qilish');
  await waitText(d, 'So‘z bo‘yicha moslik');
  check(await d.evaluate(() => document.body.innerText.includes('K29.5')), 'AI o‘chiq: so‘z bo‘yicha taklif (K29.5 surunkali gastrit)');
  await shot(d, 'ai-02-icd-suggest');

  await clickText(d, 'Qoralamani saqlash');
  await waitText(d, 'Qoralama saqlandi');
  await d.reload({ waitUntil: 'networkidle0' }); await settle(d);
  await waitText(d, 'Klinik qayd');
  check(await d.evaluate(() => !!document.querySelector('button[aria-label="K29.7 ni olib tashlash"]')), 'Saqlangan MKB-10 kodi sahifa yangilangandan keyin ham bor');
  await clickText(d, 'Ko‘rib chiqish');
  await waitText(d, 'MKB-10');
  check(await d.evaluate(() => document.querySelector('[role=dialog]').innerText.includes('K29.7')), 'Ko‘rib chiqishda MKB-10 kodi ko‘rinadi');
  await shot(d, 'ai-03-preview');

  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.goto(BASE + '/settings', { waitUntil: 'networkidle0' }); await settle(m);
  await clickText(m, 'AI', '[role=tablist] button, button');
  await waitText(m, 'MKB-10 ro‘yxati');
  check(await m.evaluate(() => document.body.innerText.includes('Namunaviy rejim') && /\d{3} ta kod/.test(document.body.innerText)), 'Sozlamalar → AI: rejim va MKB-10 ro‘yxati ko‘rinadi');
  await shot(m, 'ai-04-settings');
} catch (e) {
  for (const [i, p] of (await b.pages()).entries()) await p.screenshot({ path: new URL(`./shots/ai-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
