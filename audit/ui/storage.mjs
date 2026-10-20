// Browser storage after a working session per role: localStorage, sessionStorage, IndexedDB, cookies, Cache Storage; URLs visited.
import { launch, ctxPage, login, go, sleep, save, ROLES, ALLOWED, BASE } from './common.mjs';
const b = await launch(); const res = {};
for (const [role, label] of Object.entries(ROLES)) {
  const p = await ctxPage(b); const urls = new Set();
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) urls.add(f.url()); });
  p.on('request', (r) => { if (r.url().includes('/api/v1/') && r.method() === 'GET') urls.add('API ' + r.url().replace(BASE, '')); });
  await login(p, label);
  if (role === 'manager' || role === 'registrar') { const br = await p.$('header select'); if (br) { const v = await p.evaluate((s) => s.options[1]?.value, br); await p.select('header select', v); await sleep(500); } }
  for (const r of ALLOWED[role]) { await go(p, r); }
  // search a patient from the top bar
  if (role !== 'lab') { await p.type('header input[role=search], header form[role=search] input', 'Hasanova').catch(() => undefined); await p.keyboard.press('Enter'); await sleep(1200); }
  res[role] = await p.evaluate(async () => {
    const ls = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k).slice(0, 200)]));
    const ss = Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k).slice(0, 200)]));
    const idb = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : 'n/a';
    const caches_ = 'caches' in window ? await caches.keys() : [];
    return { localStorage: ls, sessionStorage: ss, indexedDB: idb, cacheStorage: caches_, cookie: document.cookie, sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0 };
  });
  const cookies = await p.browserContext().cookies?.() ?? await p.cookies();
  res[role].cookies = cookies.map((c) => `${c.name} httpOnly=${c.httpOnly} sameSite=${c.sameSite} secure=${c.secure}`);
  res[role].urls = [...urls].filter((u) => /[?&](search|q|text|note|diag)/i.test(u) || !u.startsWith('API'));
  console.log(role, JSON.stringify(res[role]).slice(0, 800));
  await p.browserContext().close();
}
await save('storage.json', res);
await b.close().catch(() => undefined); process.exit(0);
