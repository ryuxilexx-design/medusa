// Background work for connected cameras: (1) «pull» cameras — the server holds /ISAPI/Event/notification/alertStream
// open and feeds every notification to the same ingest as the push address (for a server inside the clinic's network
// that the camera cannot reach, e.g. behind NAT); (2) revoked codes are deleted from the cameras that hold them.
// One stream per camera, guarded by an advisory lock so two API instances never read the same camera twice.
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Db } from '../core/db';
import { config } from '../core/config';
import { now } from '../core/clock';
import { Camera, ingestEvent, SECURITY_KINDS, SNAPSHOT_MAX, NormalizedEvent } from './ingest';
import { parseIsapi } from './isapi';
import { IsapiClient } from './isapi-client';
import { CameraIsapiRow, targetOf } from './isapi.controller';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Splits a multipart/mixed byte stream into parts as they arrive. */
export class MultipartStream {
  private buf = Buffer.alloc(0);
  constructor(private boundary: string) {}
  /** Returns the parts completed by this chunk: { headers (lower-case), body }. */
  push(chunk: Buffer): { headers: Record<string, string>; body: Buffer }[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: { headers: Record<string, string>; body: Buffer }[] = [];
    const delim = Buffer.from('--' + this.boundary);
    for (;;) {
      const start = this.buf.indexOf(delim);
      if (start < 0) { if (this.buf.length > 8 * 1024 * 1024) this.buf = Buffer.alloc(0); return out; }
      const next = this.buf.indexOf(delim, start + delim.length);
      if (next < 0) { if (start > 0) this.buf = this.buf.subarray(start); return out; }
      const part = this.buf.subarray(start + delim.length, next);
      this.buf = this.buf.subarray(next);
      const sep = part.indexOf('\r\n\r\n');
      if (sep < 0) continue;
      const headers: Record<string, string> = {};
      for (const line of part.subarray(0, sep).toString('latin1').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
      let body = part.subarray(sep + 4);
      if (body.subarray(-2).toString() === '\r\n') body = body.subarray(0, -2);
      const len = Number(headers['content-length']);
      if (Number.isFinite(len) && len > 0 && len <= body.length) body = body.subarray(0, len);
      out.push({ headers, body });
    }
  }
}

/** One camera's alertStream reader. */
class Puller {
  stopped = false;
  private abort: AbortController | null = null;
  constructor(public cam: CameraIsapiRow, private db: Db, private log: Logger) {}

  stop() { this.stopped = true; this.abort?.abort(); }

  async run() {
    let backoff = 5_000;
    while (!this.stopped) {
      const client = await this.db.pool.connect();
      let locked = false;
      try {
        locked = (await client.query(`SELECT pg_try_advisory_lock(hashtext('cam-pull:' || $1)) AS ok`, [this.cam.id])).rows[0].ok;
        if (!locked) { client.release(); await sleep(30_000); continue; }
        await this.readStream();
        backoff = 5_000;
      } catch (e) {
        if (!this.stopped) {
          const msg = `alertStream: ${(e as Error).message}`;
          await this.db.rows(`UPDATE cameras SET isapi_error = $2, isapi_checked_at = $3 WHERE id = $1`, [this.cam.id, msg, now()]).catch(() => undefined);
          this.log.warn(`kamera ${this.cam.id}: ${msg}`);
          await sleep(backoff); backoff = Math.min(backoff * 2, 120_000);
        }
      } finally {
        if (locked) { await client.query(`SELECT pg_advisory_unlock(hashtext('cam-pull:' || $1))`, [this.cam.id]).catch(() => undefined); client.release(); }
      }
    }
  }

  private async readStream() {
    const target = targetOf(this.cam);
    if (!target) throw new Error('kamera ulanmagan');
    const client = await IsapiClient.create(target);
    this.abort = new AbortController();
    const res = await client.open('/ISAPI/Event/notification/alertStream', this.abort.signal);
    const ct = res.headers.get('content-type') ?? '';
    const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
    if (!res.body) throw new Error('bo‘sh oqim');
    await this.db.rows(`UPDATE cameras SET isapi_error = NULL, last_seen_at = $2 WHERE id = $1`, [this.cam.id, now()]);
    const mp = boundary ? new MultipartStream(boundary) : null;
    const cam: Camera = { id: this.cam.id, tenant_id: this.cam.tenant_id, branch_id: this.cam.branch_id, purposes: (this.cam as any).purposes, security_mode: (this.cam as any).security_mode, alert_snapshots: this.cam.alert_snapshots };
    // a security event waits briefly for the picture part the camera sends right after it
    let pending: { e: NormalizedEvent; timer: NodeJS.Timeout } | null = null;
    const flush = async () => { if (!pending) return; const { e } = pending; pending = null; await this.db.tx((q) => ingestEvent(q, cam, e)).catch((err) => this.log.warn(`kamera ${this.cam.id}: ${err.message}`)); };
    const reader = res.body.getReader();
    let lastSeen = Date.now();
    for (;;) {
      const { value, done } = await reader.read();
      if (done || this.stopped) break;
      if (Date.now() - lastSeen > 30_000) { lastSeen = Date.now(); await this.db.rows(`UPDATE cameras SET last_seen_at = $2 WHERE id = $1`, [this.cam.id, now()]).catch(() => undefined); }
      const parts = mp ? mp.push(Buffer.from(value)) : [{ headers: { 'content-type': ct }, body: Buffer.from(value) }];
      for (const p of parts) {
        const type = (p.headers['content-type'] ?? '').toLowerCase();
        if (type.startsWith('image/')) {
          if (pending && cam.alert_snapshots && p.body.length >= 64 && p.body.length <= SNAPSHOT_MAX && p.body[0] === 0xff && p.body[1] === 0xd8) {
            pending.e.snapshot = { contentType: 'image/jpeg', bytes: p.body };
            clearTimeout(pending.timer); await flush();
          }
          continue; // pictures of face events are never read
        }
        const parsed = parseIsapi(p.body, type.includes('json') ? 'application/json' : 'application/xml');
        if (parsed.heartbeat) { lastSeen = Date.now(); await this.db.rows(`UPDATE cameras SET last_seen_at = $2 WHERE id = $1`, [this.cam.id, now()]).catch(() => undefined); }
        for (const e of parsed.events) {
          await flush();
          if (SECURITY_KINDS.includes(e.kind) && cam.alert_snapshots) pending = { e, timer: setTimeout(() => void flush(), 1_500) };
          else await this.db.tx((q) => ingestEvent(q, cam, e)).catch((err) => this.log.warn(`kamera ${this.cam.id}: ${err.message}`));
        }
      }
    }
    if (pending) { clearTimeout(pending.timer); await flush(); }
  }
}

@Injectable()
export class CameraWorkers implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('CameraWorkers');
  private timers: NodeJS.Timeout[] = [];
  private pullers = new Map<string, Puller>();
  private busy = false;
  constructor(private db: Db) {}

  onApplicationBootstrap() {
    if (!config.workers) return;
    this.timers.push(setInterval(() => void this.tick(), 30_000));
    setTimeout(() => void this.tick(), 3_000);
  }
  onModuleDestroy() { this.timers.forEach(clearInterval); for (const p of this.pullers.values()) p.stop(); }

  /** Starts/stops pullers to match the cameras table and removes revoked faces from cameras. Also callable from tests. */
  async tick() {
    if (this.busy) return; this.busy = true;
    try { await this.syncPullers(); await this.cleanupRevoked(); } catch (e) { this.log.error(`${(e as Error).stack || e}`); } finally { this.busy = false; }
  }

  async syncPullers() {
    const rows: CameraIsapiRow[] = await this.db.rows(
      `SELECT c.*, c.purposes, c.security_mode FROM cameras c JOIN tenants t ON t.id = c.tenant_id
        WHERE c.delivery = 'pull' AND c.status = 'active' AND t.status = 'active' AND c.isapi_host IS NOT NULL AND c.isapi_password_enc IS NOT NULL`);
    const want = new Map(rows.map((r) => [r.id, r]));
    for (const [id, p] of this.pullers) if (!want.has(id) || JSON.stringify(targetOf(want.get(id)!)) !== JSON.stringify(targetOf(p.cam))) { p.stop(); this.pullers.delete(id); }
    for (const [id, cam] of want) if (!this.pullers.has(id)) { const p = new Puller(cam, this.db, this.log); this.pullers.set(id, p); void p.run(); }
  }

  /** A code revoked in Med.uz.ai is deleted from every camera that received it (best effort, retried each tick). */
  async cleanupRevoked() {
    const rows = await this.db.rows(
      `SELECT fcc.face_code_id, fcc.camera_id, fcc.remote_id, fc.code, c.* FROM face_code_cameras fcc
         JOIN face_codes fc ON fc.id = fcc.face_code_id JOIN cameras c ON c.id = fcc.camera_id
        WHERE fc.revoked_at IS NOT NULL LIMIT 50`);
    for (const r of rows) {
      const target = targetOf(r);
      try {
        if (target && r.fdlib_id) await (await IsapiClient.create(target)).deleteFace(r.fdlib_id, r.code, r.remote_id);
        await this.db.rows(`DELETE FROM face_code_cameras WHERE face_code_id = $1 AND camera_id = $2`, [r.face_code_id, r.camera_id]);
      } catch (e) { this.log.warn(`kamera ${r.camera_id}: ${r.code} o‘chirilmadi: ${(e as Error).message}`); }
    }
  }
}
