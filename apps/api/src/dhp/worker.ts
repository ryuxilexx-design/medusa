// DHP outbox worker.
//   export mode: pending → ready (the bundle is in the manager's NDJSON download; nothing leaves the server).
//   live mode:   pending/ready → POST [endpoint] (FHIR transaction Bundle, Bearer token) →
//                2xx sent · 401/403 failed (token) · other 4xx failed (the platform refused the content) ·
//                408/429/5xx/network → retried with backoff, failed after DHP_MAX_ATTEMPTS.
// Each row is handled in its own short transaction with FOR UPDATE SKIP LOCKED, so two API instances never send
// the same bundle twice. Nothing clinical is logged: only counts, HTTP status and the platform's short error text.
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { Db } from '../core/db';
import { config } from '../core/config';
import { decryptSecret } from '../core/secrets';
import { bundleHasPinfl, FhirBundle } from './fhir';
import { endpointOk } from './dhp.controller';

export const DHP_MAX_ATTEMPTS = 8;
/** 1, 2, 4 … minutes, at most 6 hours between tries. */
export const dhpBackoffSeconds = (attempts: number) => Math.min(60 * 2 ** Math.max(0, attempts - 1), 6 * 3600);

export type DhpFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect?: 'manual' }) => Promise<{ status: number; text(): Promise<string> }>;

/** The platform's own short explanation (OperationOutcome.issue[0].diagnostics), never more than 200 characters. */
function outcomeText(body: string) {
  try {
    const j = JSON.parse(body);
    const issue = j?.issue?.[0];
    return String(issue?.diagnostics || issue?.details?.text || issue?.code || '').slice(0, 200);
  } catch { return ''; }
}

export async function runDhpWorker(pool: Pool, opts: { fetchImpl?: DhpFetch; limit?: number; timeoutMs?: number } = {}) {
  const out = { ready: 0, sent: 0, failed: 0, retry: 0 };
  // export mode: nothing to send, the rows become part of the download
  out.ready = (await pool.query(
    `UPDATE dhp_outbox o SET status = 'ready' FROM dhp_settings s
      WHERE s.tenant_id = o.tenant_id AND s.mode = 'export' AND o.status = 'pending'`)).rowCount ?? 0;

  const doFetch: DhpFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init) as any);
  const ids = (await pool.query(
    `SELECT o.id FROM dhp_outbox o JOIN dhp_settings s ON s.tenant_id = o.tenant_id AND s.mode = 'live'
      WHERE o.status IN ('pending', 'ready') AND o.next_attempt_at <= demo_now() ORDER BY o.next_attempt_at, o.created_at LIMIT $1`, [opts.limit ?? 50])).rows;
  for (const { id } of ids) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query(
        `SELECT o.id, o.tenant_id, o.fhir, o.attempts, s.endpoint, s.token_enc FROM dhp_outbox o JOIN dhp_settings s ON s.tenant_id = o.tenant_id AND s.mode = 'live'
          WHERE o.id = $1 AND o.status IN ('pending', 'ready') FOR UPDATE OF o SKIP LOCKED`, [id])).rows[0];
      if (!row) { await c.query('ROLLBACK'); continue; }
      const fail = async (error: string, httpStatus: number | null, settingsError: boolean) => {
        await c.query(`UPDATE dhp_outbox SET status = 'failed', attempts = attempts + 1, error = $2, http_status = $3 WHERE id = $1`, [id, error.slice(0, 500), httpStatus]);
        if (settingsError) await c.query(`UPDATE dhp_settings SET last_error = $2, last_error_at = demo_now() WHERE tenant_id = $1`, [row.tenant_id, error.slice(0, 500)]);
        out.failed++;
      };
      const bundle = row.fhir as FhirBundle | null;
      if (!bundle) await fail('FHIR to‘plami yo‘q', null, false);
      else if (!bundleHasPinfl(bundle)) await fail('Bemorning JShShIR (PINFL) raqami kiritilmagan', null, false);
      else if (!endpointOk(row.endpoint)) await fail('Platforma manzili ruxsat etilganlar ro‘yxatida emas', null, false);
      else {
        let status = 0; let body = ''; let netError = '';
        try {
          const token = decryptSecret(row.token_enc);
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? config.dhp.timeoutMs);
          try {
            const res = await doFetch(row.endpoint, {
              method: 'POST', signal: ctrl.signal, body: JSON.stringify(bundle), redirect: 'manual', // a 3xx is a failure, never followed with the token
              headers: { 'content-type': 'application/fhir+json; charset=utf-8', accept: 'application/fhir+json', authorization: `Bearer ${token}` },
            });
            status = res.status; body = await res.text().catch(() => '');
          } finally { clearTimeout(timer); }
        } catch (e) { netError = (e as Error)?.name === 'AbortError' ? 'vaqt tugadi' : String((e as Error)?.message || e).slice(0, 120); }
        if (status >= 200 && status < 300) {
          await c.query(`UPDATE dhp_outbox SET status = 'sent', sent_at = demo_now(), attempts = attempts + 1, error = NULL, http_status = $2 WHERE id = $1`, [id, status]);
          await c.query(`UPDATE dhp_settings SET last_sent_at = demo_now(), last_error = NULL, last_error_at = NULL WHERE tenant_id = $1`, [row.tenant_id]);
          out.sent++;
        } else if (status === 401 || status === 403) {
          await fail(`HTTP ${status}: platforma tokenni qabul qilmadi`, status, true);
        } else if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          const why = outcomeText(body);
          await fail(`HTTP ${status}${why ? `: ${why}` : ''}`, status, true);
        } else {
          const error = netError ? `Tarmoq: ${netError}` : `HTTP ${status}`;
          if (row.attempts + 1 >= DHP_MAX_ATTEMPTS) await fail(`${error} (${DHP_MAX_ATTEMPTS} urinish)`, status || null, true);
          else {
            await c.query(`UPDATE dhp_outbox SET attempts = attempts + 1, error = $2, http_status = $3, next_attempt_at = demo_now() + make_interval(secs => $4) WHERE id = $1`,
              [id, error, status || null, dhpBackoffSeconds(row.attempts + 1)]);
            await c.query(`UPDATE dhp_settings SET last_error = $2, last_error_at = demo_now() WHERE tenant_id = $1`, [row.tenant_id, error]);
            out.retry++;
          }
        }
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally { c.release(); }
  }
  return out;
}

@Injectable()
export class DhpWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('DhpWorker');
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  constructor(private db: Db) {}

  onApplicationBootstrap() {
    if (!config.workers) return;
    const run = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        const r = await runDhpWorker(this.db.pool);
        if (r.sent || r.failed || r.retry) this.log.log(`DHP: yuborildi ${r.sent}, xato ${r.failed}, qayta ${r.retry}`);
      } catch (e) { this.log.warn(`dhp: ${(e as Error).message}`); } finally { this.busy = false; }
    };
    this.timer = setInterval(run, Math.max(10, config.dhp.intervalSeconds) * 1000);
    setTimeout(run, 20_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
