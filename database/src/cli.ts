import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { createPool, migrate, resetDemo } from './index';

async function main() {
  const cmd = process.argv[2];
  const pool = createPool();
  try {
    await migrate(pool);
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
