import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { randomUUID } from 'crypto';
import { backfillSeedCameras, backfillSeedConsents, backfillSeedGuard, backfillSeedReferrals, backfillSeedSnapshots, backfillSeedWarehouse, ensureDemoClock, ensureLeadSources, ensureStarterTemplates, migrate, readDemoClock, resetDemo } from '@meduza/db';
import { purgeSnapshots } from './cameras/ingest';
import { purgeVisitors } from './modules/security';
import { config } from './core/config';
import { syncClock } from './core/clock';
import { rawBody } from './cameras/hik.controller';
import { AppModule } from './app.module';
import { Db } from './core/db';

/** Body limit of POST /cameras/face-codes/:id/photo (a phone JPEG; base64 adds a third). */
export const FACE_PHOTO_BODY_LIMIT = '3mb';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  // camera pushes (XML / JSON / multipart): read as a raw body before the JSON parser sees it
  // a request id from the very first byte (also for errors thrown by the body parser)
  app.use((req: any, res: any, next: () => void) => { if (!req.requestId) { req.requestId = randomUUID(); res.setHeader('X-Request-Id', req.requestId); } next(); });
  app.use('/api/v1/hik', rawBody);
  // a face picture for the cameras (JPEG as base64 inside JSON) may be up to 3 MB on this one route; every other route keeps the 100 kB default
  // (wrapped: Nest looks for a middleware named «jsonParser» in the stack and would skip its own default parser if it saw this one)
  const facePhotoJson = json({ limit: FACE_PHOTO_BODY_LIMIT });
  app.use('/api/v1/cameras/face-codes', (req: any, res: any, next: (e?: unknown) => void) => facePhotoJson(req, res, next));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  (app.getHttpAdapter().getInstance() as any).disable('x-powered-by');
  (app.getHttpAdapter().getInstance() as any).set('etag', false);
  // the real client IP behind exactly N proxies (Next.js + Caddy or the Railway edge = 2); trusting every hop would let
  // anyone choose their own IP with X-Forwarded-For and walk around the login throttle
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 2));
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
    const snaps = await pool.connect().then(async (c) => { try { await c.query('BEGIN'); const n = await backfillSeedSnapshots(c, config.demoDate); await c.query('COMMIT'); return n; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } });
    const keepers = await pool.connect().then(async (c) => { try { await c.query('BEGIN'); const n = await backfillSeedWarehouse(c, config.demoDate); await c.query('COMMIT'); return n; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } });
    if (keepers) console.log(`Ombor demo: omborchi va dori partiyalari qo‘shildi`);
    const guards = await pool.connect().then(async (c) => { try { await c.query('BEGIN'); const n = await backfillSeedGuard(c, config.demoDate); await c.query('COMMIT'); return n; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } });
    if (guards) console.log(`Qorovul demo: qorovullar, smenalar, obxod va jurnallar qo‘shildi (migratsiya 038 dan oldingi baza)`);
    const partners = await pool.connect().then(async (c) => { try { await c.query('BEGIN'); const n = await backfillSeedReferrals(c, config.demoDate); await c.query('COMMIT'); return n; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } });
    if (partners) console.log(`Hamkorlar demo: ${partners} ta yo‘llovchi hamkor, manbalar va to‘lovlar qo‘shildi (migratsiya 041 dan oldingi baza)`);
    if (snaps) console.log(`Demo: ${snaps} ta kamera ogohlantirish surati qo‘shildi (migratsiya 016 dan oldingi baza)`);
  } else if (await readDemoClock(pool)) {
    // A real clinic runs on real time. A demo clock here means this is a demo database: refuse rather than
    // stamp real visits and payments with demo dates.
    throw new Error('APP_MODE=production, lekin bu bazada demo soati bor (demo bazasi). Haqiqiy klinika uchun alohida, toza baza ishlating.');
  }
  // starter note templates for every clinic created before migration 025 (idempotent; a hidden starter stays hidden)
  for (const t of (await pool.query('SELECT id FROM tenants')).rows) {
    const n = await ensureStarterTemplates(pool, t.id);
    if (n) console.log(`${n} ta boshlang‘ich qayd shabloni qo‘shildi (klinika ${t.id})`);
    await ensureLeadSources(pool, t.id); // starter lead sources (migration 041), idempotent by key
  }
  syncClock((await pool.query('SELECT demo_now() AS n')).rows[0].n);
  // expired sessions, old alert snapshots and old visitor names are removed hourly (they would only make the tables grow)
  if (config.workers) {
    const purge = () => Promise.all([
      pool.query(`DELETE FROM sessions WHERE expires_at < now() - interval '1 day'`).catch((e) => console.warn(`[sessions] purge: ${e.message}`)),
      purgeSnapshots(pool).catch((e) => console.warn(`[cameras] snapshot purge: ${e.message}`)),
      // the visitor log keeps a name only VISITOR_RETENTION_DAYS (docs/SECURITY_GUARD.md)
      purgeVisitors(pool).catch((e) => console.warn(`[security] visitor purge: ${e.message}`)),
    ]);
    void purge(); setInterval(purge, 3600_000).unref();
  }
  return app;
}
