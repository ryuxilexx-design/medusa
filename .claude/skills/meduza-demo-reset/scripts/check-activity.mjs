// Read-only: reports what people did in a Med.uz.ai demo since its last reset, so nobody wipes real demo work by accident.
// Usage:
//   node check-activity.mjs local                      -> local docker DB (meduza)
//   node check-activity.mjs remote <base-url>          -> deployed app; needs DEMO_ACCESS_CODE in the environment
import { execFileSync } from 'node:child_process';
const [, , target, base] = process.argv;
function summarize(rows) {
  const user = rows.filter((r) => r.request_id !== 'seed' && r.action !== 'demo.reset' && r.action !== 'settings.update');
  const counts = {};
  for (const r of user) counts[r.action] = (counts[r.action] ?? 0) + 1;
  console.log(JSON.stringify({ user_actions: user.length, by_action: counts, latest: user.slice(0, 5).map((r) => `${r.occurred_at} ${r.actor_name}: ${r.summary}`) }, null, 2));
  process.exitCode = user.length ? 2 : 0; // 2 = there is user activity → ask before resetting
}
if (target === 'local') {
  const out = execFileSync('docker', ['exec', 'meduza-db', 'psql', '-U', 'meduza', '-d', 'meduza', '-At', '-c',
    `SELECT coalesce(json_agg(t ORDER BY t.occurred_at DESC), '[]') FROM (SELECT action, actor_name, summary, request_id, occurred_at FROM audit_logs WHERE occurred_at >= (SELECT set_at FROM demo_clock WHERE id = 1) - interval '5 seconds' OR request_id <> 'seed') t`]).toString();
  summarize(JSON.parse(out));
} else if (target === 'remote' && base) {
  const code = process.env.DEMO_ACCESS_CODE;
  if (!code) { console.error('DEMO_ACCESS_CODE muhit o‘zgaruvchisi kerak'); process.exit(1); }
  const api = base.replace(/\/$/, '') + '/api/v1';
  const acc = (await (await fetch(api + '/demo/accounts')).json()).data.find((a) => a.role === 'manager');
  const r = await fetch(api + '/demo/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membership_id: acc.membership_id, access_code: code }) });
  if (r.status !== 200) { console.error('Kirish rad etildi:', r.status); process.exit(1); }
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const rows = (await (await fetch(api + '/audit?page_size=100', { headers: { cookie } })).json()).data;
  summarize(rows);
} else {
  console.error('Foydalanish: check-activity.mjs local | remote <base-url>'); process.exit(1);
}
