// Doctor's specialty news in the browser: menu item, /news page (tabs, topic chips in the URL, empty states), the
// «Mavzularni tanlash» dialog (own specialty locked, limit of 5, save → chips), save / mark read when articles exist,
// and the cabinet card's link. The isolated stack has no internet, so the feed may be empty: nothing is inserted.
import { launch, newPage, login, shot, settle, clickText, waitText, sleep, check, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const dialogText = (p) => p.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? '');
const topic = (p, key) => p.evaluate((k) => { const i = document.querySelector(`[role=dialog] [data-topic="${k}"] input`); return { checked: i.checked, disabled: i.disabled }; }, key);
const toggle = (p, key) => p.evaluate((k) => document.querySelector(`[role=dialog] [data-topic="${k}"] input`).click(), key);
const chips = (p) => p.evaluate(() => [...document.querySelectorAll('[data-testid="news-topics"] button')].map((x) => x.textContent.trim()));
const bodyHas = (p, s) => p.evaluate((s) => document.body.innerText.includes(s), s);
try {
  const d = await newPage(b, errors);
  await login(d, 'Shifokor');
  check(await d.evaluate(() => [...document.querySelectorAll('nav a')].some((a) => a.getAttribute('href') === '/news' && a.textContent.includes('Yangiliklar'))), 'Shifokor menyusida «Yangiliklar» bor');
  await d.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === '/news').click());
  await d.waitForFunction(() => location.pathname === '/news', { timeout: 10000 }); await settle(d);
  await waitText(d, 'Sohangiz: Terapiya (ichki kasalliklar)');
  check(await d.evaluate(() => document.querySelector('h1')?.textContent === 'Yangiliklar'), 'Sarlavha «Yangiliklar», izohda o‘z sohasi');
  const hasItems = await d.evaluate(() => !!document.querySelector('[data-news-item]'));
  if (!hasItems) check(await bodyHas(d, 'Bugungi maqolalar hali yuklanmagan'), 'Bo‘sh lenta: bitta qatorli bo‘sh holat');
  check(!(await d.evaluate(() => !!document.querySelector('[data-testid="news-topics"]'))), 'Qo‘shimcha mavzu yo‘q: mavzu tugmalari ko‘rsatilmaydi');
  await shot(d, 'news-01-page');

  // the topics dialog
  await clickText(d, 'Mavzularni tanlash'); await d.waitForSelector('[role=dialog] [data-topic]', { timeout: 10000 }); await sleep(200);
  const own = await topic(d, 'internal');
  check(own.checked && own.disabled && (await dialogText(d)).includes('Sizning sohangiz'), 'O‘z sohasi belgilangan, o‘zgartirib bo‘lmaydi («Sizning sohangiz»)');
  check((await d.evaluate(() => document.querySelectorAll('[role=dialog] [data-topic]').length)) === 25, '25 ta mavzu');
  check((await dialogText(d)).includes('Qo‘shimcha mavzular: 0 / 5'), 'Hisoblagich 0 / 5');
  await toggle(d, 'urology'); await toggle(d, 'surgery'); await sleep(150);
  check((await dialogText(d)).includes('2 / 5'), 'Urologiya va Xirurgiya tanlandi: 2 / 5');
  await shot(d, 'news-02-topics');
  for (const k of ['cardiology', 'neurology', 'pediatrics']) await toggle(d, k);
  await sleep(150);
  check((await dialogText(d)).includes('5 / 5') && (await topic(d, 'oncology')).disabled && !(await topic(d, 'cardiology')).disabled, 'Chegara: 5 tadan keyin qolganlari o‘chadi, tanlanganini olib tashlash mumkin');
  await shot(d, 'news-03-topics-limit');
  for (const k of ['cardiology', 'neurology', 'pediatrics']) await toggle(d, k);
  await sleep(150);
  check(!(await topic(d, 'oncology')).disabled, 'Bittasi olib tashlangach yana tanlash mumkin');
  await clickText(d, 'Saqlash', '[role=dialog] button');
  await waitText(d, 'Yangi mavzular bo‘yicha maqolalar bir necha daqiqada keladi');
  await d.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 10000 }); await settle(d);
  await d.waitForSelector('[data-testid="news-topics"]', { timeout: 10000 });
  const c = await chips(d);
  check(['Hammasi', 'Terapiya (ichki kasalliklar)', 'Urologiya', 'Xirurgiya'].every((x) => c.includes(x)), 'Mavzu tugmalari: Hammasi, o‘z sohasi, Urologiya, Xirurgiya');
  check(await bodyHas(d, 'va yana 2 ta mavzu'), 'Izoh: «va yana 2 ta mavzu»');
  await shot(d, 'news-04-chips');

  // a topic chip filters and lives in the URL
  await clickText(d, 'Urologiya', '[data-testid="news-topics"] button'); await settle(d);
  check(new URL(d.url()).searchParams.get('topic') === 'urology', 'Tanlangan mavzu URL’da (?topic=urology)');
  await d.reload({ waitUntil: 'networkidle0' }); await settle(d);
  await d.waitForSelector('[data-testid="news-topics"]', { timeout: 10000 });
  check(await d.evaluate(() => [...document.querySelectorAll('[data-testid="news-topics"] button')].find((x) => x.textContent.trim() === 'Urologiya')?.getAttribute('aria-pressed') === 'true'), 'Sahifa yangilangandan keyin ham Urologiya tanlangan');
  if (!(await d.evaluate(() => !!document.querySelector('[data-news-item]')))) check(await bodyHas(d, 'Bu mavzu bo‘yicha hozircha maqola yo‘q'), 'Bo‘sh mavzu: «Bu mavzu bo‘yicha hozircha maqola yo‘q»');
  await clickText(d, 'Hammasi', '[data-testid="news-topics"] button'); await settle(d);
  check(!new URL(d.url()).searchParams.get('topic'), '«Hammasi» filtrni olib tashlaydi');

  // articles (only when the stack has some): save one, mark one read
  let savedOne = false;
  if (await d.evaluate(() => !!document.querySelector('[data-news-item]'))) {
    await clickText(d, 'Saqlash', '[data-news-item] button'); await settle(d);
    await d.waitForFunction(() => [...document.querySelectorAll('[data-news-item] button')].some((x) => x.textContent.includes('Saqlangan')), { timeout: 10000 });
    savedOne = true;
    check(true, 'Maqola saqlandi («Saqlangan»)');
    const before = await d.evaluate(() => document.querySelectorAll('[data-news-item][data-unread]').length);
    if (before) {
      await clickText(d, 'O‘qildi', '[data-news-item] button'); await settle(d);
      await d.waitForFunction((n) => document.querySelectorAll('[data-news-item][data-unread]').length < n, { timeout: 10000 }, before);
      check(true, 'Maqola o‘qildi deb belgilandi, «Yangi» belgisi olib tashlandi');
    }
  } else check(true, 'Izolyatsiyalangan stekda maqola yo‘q (internet yo‘q) — saqlash/o‘qildi tekshiruvi o‘tkazib yuborildi');

  // saved tab
  await clickText(d, 'Saqlanganlar', '[role=tab]'); await settle(d);
  check(new URL(d.url()).searchParams.get('tab') === 'saved', 'Saqlanganlar varag‘i URL’da (?tab=saved)');
  if (savedOne) check(await d.evaluate(() => document.querySelectorAll('[data-news-item]').length === 1), 'Saqlanganlarda 1 ta maqola');
  else check(await bodyHas(d, 'Saqlangan maqola yo‘q'), 'Bo‘sh saqlanganlar: «Saqlangan maqola yo‘q»');
  check(!(await d.evaluate(() => !!document.querySelector('[data-testid="news-topics"]'))), 'Saqlanganlarda mavzu tugmalari yo‘q');
  await shot(d, 'news-05-saved');

  // the cabinet card links to the page
  await d.goto(BASE + '/doctor', { waitUntil: 'networkidle0' }); await settle(d);
  await waitText(d, 'Bugun sohangizda');
  await clickText(d, 'Barcha yangiliklar', 'a');
  await d.waitForFunction(() => location.pathname === '/news', { timeout: 10000 }); await settle(d);
  check(true, 'Kabinetdagi «Barcha yangiliklar» → /news');

  // the choice is saved on the server; unfollow both again
  await clickText(d, 'Mavzularni tanlash'); await d.waitForSelector('[role=dialog] [data-topic]', { timeout: 10000 }); await sleep(300);
  check((await topic(d, 'urology')).checked && (await topic(d, 'surgery')).checked, 'Qayta ochilganda tanlangan mavzular saqlangan');
  await toggle(d, 'urology'); await toggle(d, 'surgery');
  await clickText(d, 'Saqlash', '[role=dialog] button');
  await waitText(d, 'Mavzular saqlandi');
  await d.waitForFunction(() => !document.querySelector('[data-testid="news-topics"]'), { timeout: 10000 });
  check(true, 'Mavzular olib tashlandi, faqat o‘z sohasi qoldi');

  // the server keeps the limit even without the UI
  const r = await d.evaluate(async () => (await fetch('/api/v1/news/topics', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: ['urology', 'surgery', 'cardiology', 'neurology', 'pediatrics', 'oncology'] }) })).status);
  check(r === 422, 'Serverda: 6 ta mavzu → 422');

  const unexpected = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  check(!unexpected.length, 'Konsolda kutilmagan JS xato yo‘q' + (unexpected.length ? ': ' + unexpected.join(' | ') : ''));
} finally { await b.close(); }
