// Read-only: lists every request the browser makes outside 127.0.0.1 while using the main screens.
import { launch, newPage, login, settle, BASE } from './lib.mjs';
const b = await launch(); const ext = new Set(); const errors = [];
for (const [role, doc, paths] of [['Rahbar', null, ['/dashboard', '/patients', '/finance', '/settings']], ['Shifokor', 'Akmal Rasulov', ['/doctor']], ['Kassir', null, ['/cashier']], ['Laboratoriya', null, ['/lab']]]) {
  const p = await newPage(b, errors);
  p.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('data')) ext.add(u.origin); });
  await login(p, role, doc ?? undefined);
  for (const path of paths) { await p.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(p); }
}
console.log('Tashqi hostlarga so‘rovlar:', ext.size ? [...ext].join(', ') : 'yo‘q');
await b.close();
