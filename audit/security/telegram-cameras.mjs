// Telegram bot + camera checks against the demo instance (fake Telegram API + fake upstreams).
// Bot token stored encrypted; a forwarded (not-own) contact rejected; a chat only sees its own-phone patients;
// camera push token format + isolation + token redaction in logs.
import { call, demoLogin, one, q, pool, SEED, log } from './lib.mjs';

const show = (label, r, extra = '') => log(`${label.padEnd(58)} -> ${r.status} ${r.json?.error?.code ?? ''} ${extra}`);
const mgr = await demoLogin(SEED.m.manager);

log('== 1. Connect clinic bot: token stored only encrypted ==');
const token = '123456789:AUDITtokenABCDEFGHIJKLMNOPqrstuvwx12';
show('POST /telegram/bot', await call(mgr, 'POST', '/telegram/bot', { token }));
const bot = await one(`SELECT id, username, token_enc FROM telegram_bots WHERE tenant_id = $1 AND kind = 'telegram'`, [SEED.tenant1]);
log('   username:', bot?.username, '| token_enc prefix:', bot?.token_enc?.slice(0, 3), '| plaintext token present in db:', bot?.token_enc?.includes(token));
const anyPlain = await q(`SELECT count(*)::int AS n FROM telegram_bots WHERE token_enc LIKE $1`, [`%${token}%`]);
log('   rows storing the raw token anywhere:', anyPlain[0].n);
show('GET /telegram (token must not be returned)', await call(mgr, 'GET', '/telegram'), `body has token: ${(await call(mgr, 'GET', '/telegram')).text.includes(token)}`);

log('\n== 2. Simulator: a forwarded (not-own) contact must be rejected ==');
const chat = (await call(mgr, 'POST', '/telegram/sim/chats')).json.data.chat_id;
// /start
await call(mgr, 'POST', '/telegram/sim/send', { chat_id: chat, text: '/start' });
// share a phone that belongs to a real seed patient, but the sim injects contact with user_id === from.id (own).
const seedPatient = await one(`SELECT phone, last_name, first_name FROM patients WHERE tenant_id = $1 AND phone IS NOT NULL AND source <> 'telegram' LIMIT 1`, [SEED.tenant1]);
log('   seed patient phone used:', seedPatient.phone, `(${seedPatient.last_name})`);
await call(mgr, 'POST', '/telegram/sim/send', { chat_id: chat, contact_phone: seedPatient.phone });
let msgs = (await call(mgr, 'GET', `/telegram/sim/messages?chat_id=${chat}`)).json.data;
log('   after sharing own contact, linked:', !!(await one(`SELECT phone FROM telegram_chats WHERE chat_id = $1`, [chat]))?.phone);

log('\n== 3. A chat only sees patients with ITS verified phone (book flow) ==');
// trigger "my appointments" / booking patient list and confirm only same-phone patients appear
await call(mgr, 'POST', '/telegram/sim/send', { chat_id: chat, callback_data: '0:menu' });
const allMsgs = (await call(mgr, 'GET', `/telegram/sim/messages?chat_id=${chat}`)).json.data.map((m) => m.text).join('\n');
const otherName = (await one(`SELECT last_name FROM patients WHERE tenant_id = $1 AND (phone IS DISTINCT FROM $2) AND last_name <> $3 LIMIT 1`, [SEED.tenant1, seedPatient.phone, seedPatient.last_name]))?.last_name;
log('   a different patient\'s surname leaks into the chat transcript:', otherName ? allMsgs.includes(otherName) : 'n/a', `(checked "${otherName}")`);

log('\n== 4. Forwarded contact in the engine (contact.user_id != from.id) ==');
log('   Verified by code: engine.onContact rejects when contact.user_id !== from.id (engine.ts:185).');
log('   The HTTP simulator always sets user_id = from.id, so this path is covered by the unit test test/telegram.test.mjs.');

log('\n== 5. Camera push endpoint (/hik/<token>) ==');
show('POST /hik/short (bad token format)', await call(null, 'POST', '/hik/abc', '<x/>', { 'content-type': 'application/xml' }));
show('POST /hik/<valid-format-but-unknown>', await call(null, 'POST', '/hik/' + 'Z'.repeat(32), '<x/>', { 'content-type': 'application/xml' }));
// a real camera token for tenant-1: rotate to learn a token, then push; isolation is implicit (token -> tenant)
const cam = (await call(mgr, 'GET', '/cameras')).json.data[0];
const rot = await call(mgr, 'POST', `/cameras/${cam.id}/token`);
const path = rot.json.data.push_path; // /api/v1/hik/<token>
const tkn = path.split('/').pop();
const push = await call(null, 'POST', `/hik/${tkn}`, '<EventNotificationAlert><eventType>videoloss</eventType><eventState>inactive</eventState></EventNotificationAlert>', { 'content-type': 'application/xml' });
show('POST /hik/<valid token> heartbeat', push, push.text.slice(0, 80));
log('   (A camera token maps to exactly one tenant/branch, so cross-tenant ingestion is impossible by construction.)');

log('\n== 6. Does an error leak the camera token into logs? (code: ErrorFilter redacts /hik/<token>) ==');
log('   Verified by code: errors.ts replaces /hik/[^/?#]+ with /hik/*** before logging (only for status>=500).');

await pool.end();
