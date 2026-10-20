// The address a Hikvision camera pushes its events to (ISAPI «HTTP listening»): POST /api/v1/hik/<secret token>.
// The camera cannot send a session cookie, so the secret path token identifies it; only its SHA-256 is stored.
// Answers 200 quickly (the camera does not retry well); pictures in the body are never read or stored.
import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Db } from '../core/db';
import { Public } from '../core/context';
import { AppError } from '../core/errors';
import { hashToken } from '../core/guard';
import { now } from '../core/clock';
import { Camera, ingestEvent } from './ingest';
import { parseIsapi } from './isapi';

/** Largest body accepted (a camera may attach pictures; they are skipped, but the body is read once). */
export const HIK_MAX_BODY = 6 * 1024 * 1024;
const log = new Logger('Hikvision');

/** Express middleware for /api/v1/hik: the raw body as a Buffer (XML, JSON or multipart), with a size limit. */
export function rawBody(req: any, res: any, next: (e?: unknown) => void) {
  if (req.method !== 'POST') return next();
  const chunks: Buffer[] = []; let size = 0; let done = false;
  req.on('data', (c: Buffer) => {
    if (done) return;
    size += c.length;
    // too large: answer at once and let the rest of the upload drain unread (destroying the socket loses the answer)
    if (size > HIK_MAX_BODY) { done = true; chunks.length = 0; res.set('Connection', 'close').status(413).json({ error: { code: 'TOO_LARGE', message: 'So‘rov juda katta' } }); req.resume(); return; }
    chunks.push(c);
  });
  req.on('end', () => { if (done) return; done = true; req.rawBody = Buffer.concat(chunks); req._body = true; next(); });
  req.on('error', (e: unknown) => { if (!done) { done = true; next(e); } });
}

@Controller('hik')
export class HikController {
  constructor(private db: Db) {}

  @Public() @Post(':token') @HttpCode(200)
  async receive(@Param('token') token: string, @Req() req: any) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new AppError(404, 'NOT_FOUND', 'Manzil topilmadi');
    const cam = await this.db.one<Camera & { status: string }>(
      `SELECT c.id, c.tenant_id, c.branch_id, c.purposes, c.security_mode, c.status FROM cameras c JOIN tenants t ON t.id = c.tenant_id
        WHERE c.token_hash = $1 AND t.status = 'active'`, [hashToken(token)]);
    if (!cam) throw new AppError(404, 'NOT_FOUND', 'Manzil topilmadi');
    await this.db.rows(`UPDATE cameras SET last_seen_at = $2 WHERE id = $1`, [cam.id, now()]);
    if (cam.status !== 'active') return { ok: true, stored: 0 };
    const body: Buffer = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''));
    const parsed = parseIsapi(body, String(req.headers['content-type'] ?? ''));
    if (parsed.unknown.length) log.warn(`kamera ${cam.id}: tanilmagan hodisa turi: ${[...new Set(parsed.unknown)].join(', ')}`);
    let stored = 0;
    for (const e of parsed.events) {
      const r = await this.db.tx((c) => ingestEvent(c, cam, e));
      if (r.stored) stored++;
    }
    return { ok: true, stored };
  }
}
