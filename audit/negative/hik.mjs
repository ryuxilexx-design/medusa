// Camera push endpoint (/hik/<token>): malformed bodies, odd values, size limit. Isolated API only.
import { login, reset, M, record, summary, short, pool, BASE } from './lib.mjs';
await reset();
const m = await login(M.manager);
const cam = (await m.get('/cameras')).body.data.find((c) => c.purposes.includes('security'));
const path = (await m.post(`/cameras/${cam.id}/token`)).body.data.push_path;
const url = BASE.replace(/\/api\/v1$/, '') + path;
const push = async (body, ct) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': ct }, body }); const t = await r.text(); return { status: r.status, text: t, body: (() => { try { return JSON.parse(t); } catch { return t; } })() }; };
const cases = [
  ['empty', '', 'application/xml'],
  ['not xml', 'hello', 'application/xml'],
  ['broken xml', '<EventNotificationAlert><eventType>fielddetection', 'application/xml'],
  ['bad json', '{"eventType":', 'application/json'],
  ['json array', '[1,2,3]', 'application/json'],
  ['json null', 'null', 'application/json'],
  ['deep json', '['.repeat(50000) + ']'.repeat(50000), 'application/json'],
  ['NUL in xml', '<EventNotificationAlert><eventType>fielddetection</eventType><channelID>1\u0000</channelID><dateTime>2026-10-18T10:00:00+05:00</dateTime></EventNotificationAlert>', 'application/xml'],
  ['bad date', '<EventNotificationAlert><eventType>linedetection</eventType><dateTime>2026-13-45T25:61:00</dateTime></EventNotificationAlert>', 'application/xml'],
  ['year 9999', '<EventNotificationAlert><eventType>linedetection</eventType><dateTime>9999-12-31T23:59:00+05:00</dateTime></EventNotificationAlert>', 'application/xml'],
  ['huge count', JSON.stringify({ eventType: 'PeopleCounting', peopleCounting: { enter: 1e12, exit: -5 } }), 'application/json'],
  ['multipart no boundary', 'x', 'multipart/form-data'],
  ['long channel', `<EventNotificationAlert><eventType>fielddetection</eventType><channelID>${'9'.repeat(100000)}</channelID></EventNotificationAlert>`, 'application/xml'],
];
for (const [name, body, ct] of cases) { const r = await push(body, ct); record('HIK', r.status === 200, `hik push: ${name}`, short(r)); }
const big = await push(Buffer.alloc(7 * 1024 * 1024, 'a'), 'application/octet-stream');
record('HIK-SIZE', big.status === 413, 'hik push 7MB → 413', short(big));
const ev = (await pool.query(`SELECT occurred_at, kind, dedupe_key FROM camera_events WHERE camera_id = $1 ORDER BY occurred_at DESC LIMIT 3`, [cam.id])).rows;
console.log('latest events:', JSON.stringify(ev));
summary(); await pool.end();
