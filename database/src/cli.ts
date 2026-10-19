import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { randomUUID } from 'crypto';
import { buildSeed, createPool, migrate, resetDemo, SEED_IDS } from './index';
import { generateTempPassword, hashPassword } from './password';

/** --key value pairs from argv. */
function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[++i];
  return out;
}

/** Same rule as the web form: +998XXXXXXXXX or a lowercase username. */
function normLogin(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, '');
  if (/^\+?998\d{9}$/.test(digits)) return '+' + digits.replace(/^\+/, '');
  if (/^\d{9}$/.test(digits)) return '+998' + digits;
  const u = raw.trim().toLowerCase();
  return /^[a-z][a-z0-9._-]{2,31}$/.test(u) ? u : null;
}

const USAGE = `Foydalanish:
  npm run db:create-clinic -- --name "Klinika nomi" --branch "Filial nomi" --manager-name "F.I.Sh." --manager-login +998901234567 [--branch-code MRK] [--catalog demo]

  --catalog demo  — demo xizmatlar katalogi (30 ta xizmat, narxlari bilan) nusxalanadi; keyin klinika o‘zi tahrirlaydi.`;

/** Onboards a real clinic: tenant + first branch + manager with a one-time temporary password. */
async function createClinic(pool: ReturnType<typeof createPool>, a: Record<string, string>) {
  const name = a.name?.trim(), branch = a.branch?.trim(), managerName = a['manager-name']?.trim();
  const login = a['manager-login'] ? normLogin(a['manager-login']) : null;
  const code = (a['branch-code'] || 'ASO').trim().toUpperCase();
  if (!name || !branch || !managerName || !login || !/^[A-Z0-9]{2,8}$/.test(code)) { console.error(USAGE); process.exit(2); }
  const temp = generateTempPassword();
  const hash = await hashPassword(temp);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if ((await c.query('SELECT 1 FROM users WHERE login = $1', [login])).rowCount) throw new Error(`«${login}» logini band`);
    const tenantId = randomUUID(), branchId = randomUUID(), userId = randomUUID(), membershipId = randomUUID();
    await c.query(`INSERT INTO tenants (id, name) VALUES ($1, $2)`, [tenantId, name]);
    await c.query(`INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)`, [branchId, tenantId, branch, code]);
    await c.query(`INSERT INTO users (id, email, full_name, login, password_hash, must_change_password) VALUES ($1, NULL, $2, $3, $4, true)`, [userId, managerName, login, hash]);
    await c.query(`INSERT INTO memberships (id, tenant_id, user_id, role, branch_ids, title) VALUES ($1, $2, $3, 'manager', $4, 'Klinika rahbari')`, [membershipId, tenantId, userId, [branchId]]);
    let services = 0;
    if (a.catalog === 'demo') {
      const seed = buildSeed(process.env.DEMO_DATE || '2026-10-18');
      const latest = new Map<string, { amount: number; valid_from: Date }>();
      for (const p of seed.service_prices as any[]) { const cur = latest.get(p.service_id); if (!cur || p.valid_from > cur.valid_from) latest.set(p.service_id, p); }
      for (const s of seed.services as any[]) {
        if (s.tenant_id !== SEED_IDS.tenant) continue;
        const id = randomUUID();
        await c.query(`INSERT INTO services (id, tenant_id, code, name, category, duration_min, share_percent, lab_template, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
          [id, tenantId, s.code, s.name, s.category, s.duration_min, s.share_percent, s.lab_template ? JSON.stringify(s.lab_template) : null]);
        await c.query(`INSERT INTO service_prices (tenant_id, service_id, branch_id, amount, valid_from) VALUES ($1,$2,NULL,$3, now())`, [tenantId, id, latest.get(s.id)!.amount]);
        services++;
      }
    }
    await c.query(`INSERT INTO audit_logs (tenant_id, actor_name, action, resource_type, resource_id, summary) VALUES ($1, 'CLI', 'tenant.create', 'tenant', $2, $3)`,
      [tenantId, tenantId, `Klinika yaratildi: ${name}; rahbar ${managerName} (${login})`]);
    await c.query('COMMIT');
    console.log(`Klinika yaratildi: ${name}\n  filial: ${branch} (${code})\n  xizmatlar: ${services}\n  rahbar: ${managerName}\n  login: ${login}\n  vaqtinchalik parol: ${temp}\n` +
      `Parolni rahbarga shaxsan bering — birinchi kirishda u yangi parol o‘rnatadi. Bu parol boshqa ko‘rsatilmaydi.`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Loads the official ICD-10 (MKB-10) list: CSV/TSV with columns code;title_ru[;title_uz] (header optional).
 * Existing codes are updated, new ones added; with --replace the starter codes missing from the file are removed
 * (codes already used in notes stay valid because notes keep their own title snapshot).
 */
async function importIcd10(pool: ReturnType<typeof createPool>, argv: string[]) {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) { console.error('Foydalanish: npm run db:import-icd10 -- <fayl.csv> [--replace]'); process.exit(2); }
  const fs = await import('fs');
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const unq = (v: string | undefined) => (v ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"');
  const rows: [string, string, string | null][] = [];
  const bad: number[] = [];
  lines.forEach((l, i) => {
    const [c, ru, uz] = l.split(sep).map(unq);
    const code = c.toUpperCase();
    if (i === 0 && !/^[A-Z][0-9]{2}/.test(code)) return; // header
    if (!/^[A-Z][0-9]{2}(\.[0-9]{1,2})?$/.test(code) || !ru) { bad.push(i + 1); return; }
    rows.push([code, ru, uz || null]);
  });
  if (!rows.length) { console.error('Faylda yaroqli qator topilmadi'); process.exit(2); }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const [code, ru, uz] of rows)
      await c.query(`INSERT INTO icd10_codes (code, title_ru, title_uz, source, updated_at) VALUES ($1,$2,$3,'official',now())
                     ON CONFLICT (code) DO UPDATE SET title_ru = EXCLUDED.title_ru, title_uz = COALESCE(EXCLUDED.title_uz, icd10_codes.title_uz), source = 'official', updated_at = now()`, [code, ru, uz]);
    let removed = 0;
    if (argv.includes('--replace')) removed = (await c.query(`DELETE FROM icd10_codes WHERE source = 'starter' AND NOT (code = ANY($1))`, [rows.map((r) => r[0])])).rowCount ?? 0;
    await c.query('COMMIT');
    console.log(`MKB-10: ${rows.length} ta kod yuklandi${removed ? `, ${removed} ta boshlang‘ich kod olib tashlandi` : ''}${bad.length ? `; o‘tkazib yuborilgan qatorlar: ${bad.slice(0, 20).join(', ')}${bad.length > 20 ? '…' : ''}` : ''}`);
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}

async function main() {
  const cmd = process.argv[2];
  const pool = createPool();
  try {
    await migrate(pool);
    if (cmd === 'create-clinic') await createClinic(pool, args(process.argv.slice(3)));
    if (cmd === 'import-icd10') await importIcd10(pool, process.argv.slice(3));
    if (cmd === 'reset' || cmd === 'seed') {
      const demoDate = process.env.DEMO_DATE || '2026-10-18';
      const { counts, clock } = await resetDemo(pool, demoDate, process.env.DEMO_TIME);
      console.log(`Demo ma'lumotlari va demo vaqti tiklandi. Demo vaqti boshlanishi: ${new Date(clock.demo_anchor.getTime() + 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} (Toshkent)`);
      console.table(counts);
    }
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
