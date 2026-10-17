import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ensureDemoClock, migrate, resetDemo } from '@meduza/db';
import { config } from './core/config';
import { syncClock } from './core/clock';
import { AppModule } from './app.module';
import { Db } from './core/db';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
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
  // Create the clock anchor only if missing; an existing anchor is kept so a restart never rewinds demo time.
  await ensureDemoClock(pool, config.demoDate, config.demoTime);
  syncClock((await pool.query('SELECT demo_now() AS n')).rows[0].n);
  return app;
}
