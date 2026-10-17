import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ensureDemoClock, migrate } from '@meduza/db';
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
  const pool = app.get(Db).pool;
  await migrate(pool, () => undefined);
  // Create the clock anchor only if missing; an existing anchor is kept so a restart never rewinds demo time.
  await ensureDemoClock(pool, config.demoDate, config.demoTime);
  syncClock((await pool.query('SELECT demo_now() AS n')).rows[0].n);
  return app;
}
