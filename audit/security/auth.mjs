// Auth & session audit: account lockout, user enumeration, IP throttle vs X-Forwarded-For, forced password
// change, logout, session revocation on password change / reset / deactivation, cookie flags, CSRF surface.
import { call, cookieFrom, demoLogin, passwordLogin, one, pool, SEED, log } from './lib.mjs';

const show = (label, r, extra = '') => log(`${label.padEnd(60)} -> ${r.status} ${r.json?.error?.code ?? ''} ${extra}`);
let ipN = 1;
const freshIp = () => ({ 'x-forwarded-for': `203.0.113.${(ipN++ % 250) + 1}` });
const mgr = await demoLogin(SEED.m.manager);

async function newStaff(role = 'registrar') {
  const login = `sec_${role}_${Date.now() % 1e7}`;
  const r = await call(mgr, 'POST', '/staff', { full_name: `Audit ${role} user`, role, login, branch_ids: [SEED.branchM] });
  if (r.status !== 201) throw new Error(r.text);
  return { login, temp: r.json.data.temp_password, membership: r.json.data.membership_id };
}

log('== 1. Account lockout after 5 wrong tries, then correct secret ==');
const u = await newStaff();
for (let i = 1; i <= 6; i++) {
  const r = await passwordLogin(u.login, 'Wrong12345', freshIp());
  show(`try ${i} wrong`, r);
}
const afterLock = await passwordLogin(u.login, u.temp, freshIp());
show('correct secret while locked', afterLock);
const lockRow = await one(`SELECT failed_logins, locked_until > now() AS locked FROM users WHERE login = $1`, [u.login]);
log('   db state:', JSON.stringify(lockRow));

log('\n== 2. User enumeration: unknown login vs known login (wrong secret) ==');
const t0 = Date.now(); const unknown = await passwordLogin('nosuchuser_zzz', 'Wrong12345', freshIp()); const dtU = Date.now() - t0;
const u2 = await newStaff();
const t1 = Date.now(); const known = await passwordLogin(u2.login, 'Wrong12345', freshIp()); const dtK = Date.now() - t1;
show('unknown login', unknown, `${dtU}ms`);
show('known login wrong secret', known, `${dtK}ms`);
log(`   same error code: ${unknown.json?.error?.code === known.json?.error?.code}; timing delta ${Math.abs(dtU - dtK)}ms`);

log('\n== 3. Can the lockout be weaponised against a colleague? (same account, same IP) ==');
const victim = await newStaff();
for (let i = 0; i < 5; i++) await passwordLogin(victim.login, 'Wrong12345', { 'x-forwarded-for': '198.51.100.7' });
const victimLocked = await one(`SELECT locked_until > now() AS locked FROM users WHERE login = $1`, [victim.login]);
log('   victim account locked by attacker from one IP:', JSON.stringify(victimLocked));

log('\n== 4. Per-IP throttle (20 wrong / 15 min across accounts) from one source ==');
let last;
for (let i = 1; i <= 24; i++) last = await passwordLogin(`enum_user_${i}`, 'Wrong12345', { 'x-forwarded-for': '198.51.100.50' });
show('24th wrong try from one IP', last);

log('\n== 5. Forced password change: only /me, /auth/password, /logout reachable ==');
const fc = await newStaff('cashier');
const fl = await passwordLogin(fc.login, fc.temp, freshIp());
const cookie = fl.cookie;
show('login with temp secret', fl, `must_change via /me below`);
show('  GET /me', await call(cookie, 'GET', '/me'), `must_change=${(await call(cookie, 'GET', '/me')).json?.data?.must_change_password}`);
show('  GET /patients (should be blocked)', await call(cookie, 'GET', '/patients'));
show('  POST /cash-shifts (should be blocked)', await call(cookie, 'POST', '/cash-shifts', { branch_id: SEED.branchM, opening_cash: 0 }));
show('  GET /cash-shifts/current (should be blocked)', await call(cookie, 'GET', '/cash-shifts/current'));
const newPw = `Audit${Date.now()}z9`;
show('  POST /auth/password', await call(cookie, 'POST', '/auth/password', { current_password: fc.temp, new_password: newPw }));
show('  GET /patients after change', await call(cookie, 'GET', '/patients'));

log('\n== 6. Other sessions end when the secret changes ==');
const su = await newStaff('lab');
const l1 = await passwordLogin(su.login, su.temp, freshIp());
const p1 = `Audit${Date.now()}aa1`; await call(l1.cookie, 'POST', '/auth/password', { current_password: su.temp, new_password: p1 });
const sA = await passwordLogin(su.login, p1, freshIp());
const sB = await passwordLogin(su.login, p1, freshIp());
show('session A /me before change', await call(sA.cookie, 'GET', '/me'));
const p2 = `Audit${Date.now()}bb2`;
show('session B changes secret', await call(sB.cookie, 'POST', '/auth/password', { current_password: p1, new_password: p2 }));
show('session A /me after change (expect 401)', await call(sA.cookie, 'GET', '/me'));
show('session B /me after change (still valid)', await call(sB.cookie, 'GET', '/me'));

log('\n== 7. Manager reset closes the staff member\'s sessions ==');
const ru = await newStaff('registrar');
const rl = await passwordLogin(ru.login, ru.temp, freshIp());
const rp = `Audit${Date.now()}cc3`; await call(rl.cookie, 'POST', '/auth/password', { current_password: ru.temp, new_password: rp });
const active = await passwordLogin(ru.login, rp, freshIp());
show('active session before reset', await call(active.cookie, 'GET', '/me'));
show('manager resets secret', await call(mgr, 'POST', `/staff/${ru.membership}/reset-password`));
show('active session after reset (expect 401)', await call(active.cookie, 'GET', '/me'));

log('\n== 8. Deactivation / role change ends sessions ==');
const du = await newStaff('cashier');
const dl = await passwordLogin(du.login, du.temp, freshIp());
const dp = `Audit${Date.now()}dd4`; await call(dl.cookie, 'POST', '/auth/password', { current_password: du.temp, new_password: dp });
const dsession = (await passwordLogin(du.login, dp, freshIp())).cookie;
show('before deactivation', await call(dsession, 'GET', '/me'));
show('manager deactivates', await call(mgr, 'PATCH', `/staff/${du.membership}`, { status: 'inactive' }));
show('after deactivation (expect 401)', await call(dsession, 'GET', '/me'));

log('\n== 9. Logout invalidates the cookie ==');
const lo = await demoLogin(SEED.m.registrar);
show('before logout', await call(lo, 'GET', '/me'));
show('logout', await call(lo, 'POST', '/logout'));
show('reuse cookie after logout (expect 401)', await call(lo, 'GET', '/me'));

log('\n== 10. Session cookie flags ==');
const raw = await call(null, 'POST', '/demo/login', { membership_id: SEED.m.manager });
const setCookie = raw.headers.getSetCookie?.().find((c) => c.startsWith('meduza_session=')) ?? '';
log('   Set-Cookie:', setCookie);
log(`   HttpOnly=${/HttpOnly/i.test(setCookie)} SameSite=${/SameSite=(\w+)/i.exec(setCookie)?.[1]} Secure=${/Secure/i.test(setCookie)} Path=${/Path=(\S+?);/i.exec(setCookie)?.[1]}`);

log('\n== 11. Token randomness & server-chosen token ==');
const c1 = cookieFrom(await call(null, 'POST', '/demo/login', { membership_id: SEED.m.manager }));
const c2 = cookieFrom(await call(null, 'POST', '/demo/login', { membership_id: SEED.m.manager }));
log('   two logins give different tokens:', c1 !== c2);
const forged = await call('meduza_session=attacker-chosen-token-value', 'GET', '/me');
show('attacker-chosen cookie value', forged);

log('\n== 12. Response headers (no cache, request id, no x-powered-by) ==');
const h = await call(mgr, 'GET', '/me');
log('   X-Request-Id:', h.headers.get('x-request-id'), '| Cache-Control:', h.headers.get('cache-control'), '| X-Powered-By:', h.headers.get('x-powered-by'));

log('\n== 13. State-changing endpoints: accept non-JSON / form bodies? (CSRF surface) ==');
const form = await call(mgr, 'POST', '/patients', 'last_name=x&first_name=y', { 'content-type': 'application/x-www-form-urlencoded' });
show('POST /patients as urlencoded form', form);
const textBody = await call(mgr, 'POST', `/cash-shifts`, 'not json', { 'content-type': 'text/plain' });
show('POST /cash-shifts as text/plain', textBody);

await pool.end();
