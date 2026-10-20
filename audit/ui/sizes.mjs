// Response sizes (transfer, uncompressed) of API calls on the heaviest pages.
import { launch, ctxPage, login, go, sleep, BASE } from './common.mjs';
const b = await launch(); const sizes = [];
for (const [label, paths] of [['Rahbar', ['/dashboard', '/patients', '/schedule', '/finance', '/reports', '/cameras', '/settings', '/lab', '/cashier']], ['Shifokor', ['/doctor', '/news', '/patients']]]) {
  const p = await ctxPage(b);
  p.on('response', async (r) => { if (r.url().includes('/api/v1/')) { try { const buf = await r.buffer(); sizes.push([buf.length, r.url().replace(BASE, '')]); } catch {} } });
  await login(p, label); for (const x of paths) await go(p, x);
  await p.browserContext().close();
}
sizes.sort((a, b) => b[0] - a[0]); console.log(sizes.slice(0, 10).map(([n, u]) => `${(n / 1024).toFixed(0)} KB ${u}`).join('\n'));
const polls = {}; for (const [, u] of sizes) { const k = u.split('?')[0]; polls[k] = (polls[k] || 0) + 1; }
console.log(Object.entries(polls).sort((a, b) => b[1] - a[1]).slice(0, 8));
await b.close().catch(() => undefined); process.exit(0);
