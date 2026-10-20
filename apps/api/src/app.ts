import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { backfillSeedCameras, backfillSeedConsents, ensureDemoClock, migrate, readDemoClock, resetDemo } from '@meduza/db';
import { config } from './core/config';
import { syncClock } from './core/clock';
import { rawBody } from './cameras/hik.controller';
import { AppModule } from './app.module';
import { Db } from './core/db';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  // camera pushes (XML / JSON / multipart): read as a raw body before the JSON parser sees it
  app.use('/api/v1/hik', rawBody);
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  (app.getHttpAdapter().getInstance() as any).disable('x-powered-by');
  (app.getHttpAdapter().getInstance() as any).set('etag', false);
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', true); // real client IP behind Next.js / Railway proxy
  const pool = app.get(Db).pool;
  await migrate(pool, () => undefined);
  // First deploy: an empty database gets the deterministic demo seed (never runs in production mode).
  if (config.autoSeed && config.demoEnabled && !(await pool.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n) {
    await resetDemo(pool, config.demoDate, config.demoTime);
    console.log('Bo‘sh baza: demo ma’lumotlari avtomatik yuklandi');
  }
  if (config.demoEnabled) {
    // Create the clock anchor only if missing; an existing anchor is kept so a restart never rewinds demo time.
    await ensureDemoClock(pool, config.demoDate, config.demoTime);
    const added = await backfillSeedConsents(pool, config.demoDate);
    if (added) console.log(`Demo: ${added} ta seed bemoriga rozilik yozuvi qo‘shildi (migratsiya 011 dan oldingi baza)`);
    const cams = await pool.connect().then(async (c) => { try { await c.query('BEGIN'); const n = await backfillSeedCameras(c, config.demoDate); await c.query('COMMIT'); return n; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } });
    if (cams) console.log(`Demo: ${cams} ta demo kamera va ularning hodisalari qo‘shildi (migratsiya 012 dan oldingi baza)`);
  } else if (await readDemoClock(pool)) {
    // A real clinic runs on real time. A demo clock here means this is a demo database: refuse rather than
    // stamp real visits and payments with demo dates.
    throw new Error('APP_MODE=production, lekin bu bazada demo soati bor (demo bazasi). Haqiqiy klinika uchun alohida, toza baza ishlating.');
  }
  syncClock((await pool.query('SELECT demo_now() AS n')).rows[0].n);
  return app;
}
