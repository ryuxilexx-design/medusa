import { createApp } from './app';
import { config } from './core/config';
import { now } from './core/clock';

async function main() {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(config.port, '127.0.0.1');
  const db = new URL(config.databaseUrl).pathname.slice(1);
  const t = new Date(now().getTime() + 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  console.log(`Med.uz.ai API: http://127.0.0.1:${config.port}/api/v1 · baza: ${db} · rejim: ${config.mode} · demo vaqti: ${t} (Toshkent) · AI: ${config.ai.mode}`);
  if (!t.startsWith(config.demoDate)) console.warn(`Diqqat: demo vaqti (${t}) DEMO_DATE=${config.demoDate} bilan mos emas. Sana o‘zgargan bo‘lsa: npm run db:reset`);
}
main().catch((e) => { console.error(e); process.exit(1); });
