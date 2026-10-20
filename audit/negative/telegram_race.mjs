// Telegram simulator: parallel confirm presses, bot vs staff on the same slot, forged/garbage callbacks.
import { login, reset, M, record, summary, short, pool, SEED_IDS } from './lib.mjs';
const tally = (rs) => rs.reduce((a, r) => { const k = r.status + (r.body?.error?.code ? ':' + r.body.error.code : ''); a[k] = (a[k] || 0) + 1; return a; }, {});
await reset();
const m = await login(M.manager), reg = await login(M.registrar);
const out = async (chat) => (await m.get(`/telegram/sim/messages?chat_id=${chat}`)).body.data.filter((x) => x.direction === 'out');
const say = (chat, text) => m.post('/telegram/sim/send', { chat_id: chat, text });
async function btn(chat, match) {
  for (const msg of (await out(chat)).reverse()) {
    const b = (msg.markup?.inline_keyboard ?? []).flat().find((x) => match(x.text));
    if (b) return b;
  }
  throw new Error('no button; last=' + JSON.stringify((await out(chat)).at(-1)));
}
const press = async (chat, match) => { const b = await btn(chat, match); await m.post('/telegram/sim/send', { chat_id: chat, callback_data: b.callback_data, label: b.text }); return b; };
const p = (await pool.query(`SELECT id, phone FROM patients WHERE phone IS NOT NULL AND tenant_id = $1 ORDER BY patient_number LIMIT 1 OFFSET 40`, [SEED_IDS.tenant])).rows[0];
const chat = (await m.post('/telegram/sim/chats')).body.data.chat_id;
await say(chat, '/start'); await m.post('/telegram/sim/send', { chat_id: chat, contact_phone: p.phone });
await say(chat, '📅 Qabulga yozilish');
if ((await out(chat)).at(-1).text.includes('Kim uchun')) await press(chat, (t) => !t.includes('➕'));
await press(chat, (t) => t.includes('so‘m'));
const docBtn = await press(chat, (t) => t.includes('·'));
await press(chat, (t) => /^\d\d\.\d\d /.test(t));
const timeBtn = await press(chat, (t) => /^\d\d:\d\d$/.test(t));
const ok = await btn(chat, (t) => t.includes('Tasdiqlash'));
const before = (await pool.query(`SELECT count(*)::int n FROM appointments WHERE patient_id = $1`, [p.id])).rows[0].n;
const rs = await Promise.all(Array.from({ length: 10 }, () => m.post('/telegram/sim/send', { chat_id: chat, callback_data: ok.callback_data, label: 'ok' })));
const after = (await pool.query(`SELECT count(*)::int n FROM appointments WHERE patient_id = $1`, [p.id])).rows[0].n;
record('TG-R1', after - before === 1 && !Object.keys(tally(rs)).some((k) => k.startsWith('5')), 'bot confirm pressed ×10 in parallel: one booking', `${JSON.stringify(tally(rs))} new bookings=${after - before}`);
// garbage callbacks
for (const cb of ['a:cy:', 'a:cy:' + 'f'.repeat(36), 'a:zz:00000000-0000-0000-0000-000000000000', ':', '999999999999999999999:0', 'x'.repeat(64)]) {
  const r = await m.post('/telegram/sim/send', { chat_id: chat, callback_data: cb, label: 'x' });
  record('TG-G', r.status === 200, `garbage callback "${cb.slice(0, 20)}" handled`, short(r));
}
// forged cancel of another patient's appointment
const foreign = (await pool.query(`SELECT a.id FROM appointments a JOIN patients q ON q.id = a.patient_id WHERE a.status = 'scheduled' AND q.phone IS DISTINCT FROM $1 AND a.starts_at > now() LIMIT 1`, [p.phone])).rows[0];
await m.post('/telegram/sim/send', { chat_id: chat, callback_data: `a:cy:${foreign.id}`, label: 'x' });
const st = (await pool.query(`SELECT status FROM appointments WHERE id = $1`, [foreign.id])).rows[0].status;
record('TG-F', st === 'scheduled', 'forged a:cy for a foreign appointment is refused', st);
summary(); await pool.end();
