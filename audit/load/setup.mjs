// Gives the synthetic lt-* staff a password and opens a cash shift for each synthetic cashier (load-test DB only).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { passwordLogin, req } from './lib.mjs';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../../database/dist/src/password.js');
export const LT_PASSWORD = 'Load-test-2026';
export const sql = (q) => execFileSync(new URL('./psql.sh', import.meta.url).pathname, ['-At', '-F', '\t', '-c', q], { encoding: 'utf8', maxBuffer: 256 << 20 }).trim();

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (sql('select current_database()') !== 'meduza_load_test') throw new Error('wrong DB');
  const hash = await hashPassword(LT_PASSWORD);
  console.log(sql(`UPDATE users SET password_hash = '${hash}', must_change_password = false WHERE login LIKE 'lt-%' RETURNING login`).split('\n').length, 'passwords set');
  const cashiers = sql(`SELECT u.login, m.branch_ids[1] FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.login LIKE 'lt-cashier-%'`).split('\n').map((l) => l.split('\t'));
  for (const [login, branch] of cashiers) {
    const cookie = await passwordLogin(login, LT_PASSWORD);
    const r = await req('/cash-shifts', { method: 'POST', cookie, body: { branch_id: branch, opening_cash: 100_000_000 } });
    console.log(login, 'shift', r.status, r.json?.error?.code ?? '');
  }
}
