// Staff accounts in the browser: manager adds a cashier → temp password shown once → cashier signs in with it →
// forced password change → works → manager deactivates → the cashier's next request lands on /login.
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, fill, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
try {
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.goto(BASE + '/staff', { waitUntil: 'networkidle0' }); await settle(m);
  await clickText(m, 'Xodim qo‘shish');
  await waitText(m, 'Telefon yoki login');
  await fill(m, 'F.I.Sh.', 'Sinov Kassirov', '[role=dialog]');
  await fill(m, 'Rol', 'Kassir', '[role=dialog]');
  await fill(m, 'Telefon yoki login', '+998 93 555 44 33', '[role=dialog]');
  await m.evaluate(() => [...document.querySelectorAll('[role=dialog] label')].find((l) => l.textContent.includes('Markaziy filial')).click()); await sleep(150);
  await shot(m, 'auth-01-create');
  await clickText(m, 'Xodimni qo‘shish');
  await waitText(m, 'Vaqtinchalik parol');
  const temp = await m.evaluate(() => document.querySelector('[role=dialog] .select-all')?.textContent?.trim());
  await shot(m, 'auth-02-temp-password');
  check(/^[a-z2-9]{10}$/.test(temp ?? ''), 'Vaqtinchalik parol bir marta ko‘rsatildi');
  await clickText(m, 'Tushunarli, yopish'); await settle(m);
  check(await m.evaluate(() => document.body.innerText.includes('Sinov Kassirov') && document.body.innerText.includes('Vaqtinchalik parol')), 'Ro‘yxatda yangi xodim «Vaqtinchalik parol» holatida');
  check(!(await m.evaluate((t) => document.body.innerText.includes(t), temp)), 'Modal yopilgach parol sahifada qolmadi');

  // Cashier: wrong password → generic error; right temp password → forced change screen
  const c = await newPage(b, errors);
  await c.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await clickText(c, 'Login va parol', '[role=tab]');
  await fill(c, 'Telefon yoki login', '935554433');
  await fill(c, 'Parol', 'notogri123');
  await clickText(c, 'Kirish', 'form[aria-label="Xodim kirishi"] button');
  await waitText(c, 'Login yoki parol noto‘g‘ri');
  check(true, 'Noto‘g‘ri parol: umumiy xato matni');
  await fill(c, 'Parol', temp);
  await clickText(c, 'Kirish', 'form[aria-label="Xodim kirishi"] button');
  await waitText(c, 'Yangi parol o‘rnating', 15000);
  await shot(c, 'auth-03-forced-change');
  check(!(await c.evaluate(() => !!document.querySelector('nav[aria-label="Asosiy menyu"]'))), 'Parol almashmaguncha menyu ochilmaydi');
  await fill(c, 'Joriy parol', temp);
  await fill(c, 'Yangi parol', 'Kassa2026yangi');
  await fill(c, 'Yangi parolni takrorlang', 'Kassa2026boshqa');
  await clickText(c, 'Parolni saqlash va davom etish');
  await waitText(c, 'Parollar mos emas');
  check(true, 'Takroriy parol mos kelmasa — forma xatosi');
  await fill(c, 'Yangi parolni takrorlang', 'Kassa2026yangi');
  await clickText(c, 'Parolni saqlash va davom etish');
  await c.waitForFunction(() => !!document.querySelector('nav[aria-label="Asosiy menyu"]'), { timeout: 15000 }); await settle(c);
  check(await c.evaluate(() => document.body.innerText.includes('Sinov Kassirov') && document.body.innerText.includes('Kassir')), 'Yangi parol bilan kassir ish joyi ochildi');
  // password change lives in the user menu of the top bar
  await c.click('[data-testid=user-menu]'); await sleep(200);
  check(await c.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && b.textContent.includes('Parolni o‘zgartirish'))), 'Foydalanuvchi menyusida «Parolni o‘zgartirish» bor');
  await shot(c, 'auth-04-cashier-home');

  // Manager deactivates → cashier is sent to /login on the next request
  await m.reload({ waitUntil: 'networkidle0' }); await settle(m);
  await m.evaluate(() => document.querySelector('button[aria-label="Sinov Kassirov: tahrirlash"]').click()); await sleep(300);
  await clickText(m, 'Faolsizlantirish');
  await waitText(m, 'Xodimni faolsizlantirasizmi?');
  await clickText(m, 'Ha', '[role=dialog] button');
  await settle(m);
  check(await m.evaluate(() => [...document.querySelectorAll('tr')].some((r) => r.innerText.includes('Sinov Kassirov') && r.innerText.includes('Nofaol'))), 'Rahbar xodimni faolsizlantirdi');
  await c.goto(BASE + '/cashier', { waitUntil: 'networkidle0' });
  await c.waitForFunction(() => location.pathname.startsWith('/login'), { timeout: 15000 });
  check(true, 'Faolsizlantirilgan kassir keyingi so‘rovda login sahifasiga qaytdi');
} catch (e) {
  for (const [i, p] of (await b.pages()).entries()) await p.screenshot({ path: new URL(`./shots/auth-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
// 401s are expected here (deliberate wrong password, requests after deactivation); anything else is a real error.
const real = errors.filter((e) => !e.includes('status of 401'));
check(real.length === 0, `Brauzer xatolari yo‘q (kutilgan 401 lardan tashqari)${real.length ? ': ' + real.join(' | ') : ''}`);
