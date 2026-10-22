// GET /api/v1/health — for the container HEALTHCHECK and an external uptime monitor. No session, no tenant, no audit:
// it only proves that the process answers and the database responds within 2 seconds.
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Db } from '../core/db';
import { config } from '../core/config';
import { Public, SessionFree } from '../core/context';

const DB_TIMEOUT_MS = 2000;

@Controller()
export class HealthController {
  constructor(private db: Db) {}

  @Public() @SessionFree() @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS); });
    try {
      const r = await Promise.race([this.db.pool.query(config.demoEnabled ? 'SELECT demo_now() AS n' : 'SELECT 1 AS n'), timeout]);
      const demo = config.demoEnabled && r.rows[0]?.n instanceof Date ? r.rows[0].n.toISOString() : undefined;
      return { ok: true, db: 'ok', ...(demo ? { demo_clock: demo } : {}), version: config.version };
    } catch (e) {
      // the error text stays out of the answer (it may name the database host); the log has it
      console.warn(`[health] database: ${(e as Error).message}`);
      res.status(503);
      return { ok: false, db: 'down', version: config.version };
    } finally {
      clearTimeout(timer);
    }
  }
}
