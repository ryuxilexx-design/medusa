// Manager's connection to the Ministry of Health's Digital Health Platform (DHP / DMED): mode, endpoint, token
// (write-only, encrypted), outbox counts and list (no clinical payload), the bounded NDJSON export and retry.
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { translate } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { coded, invalid, notFound } from '../core/errors';
import { isDate, isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { config } from '../core/config';
import { encryptSecret, secretsConfigured } from '../core/secrets';
import { addDays } from '../core/clock';
import { buildDhpBundle, DhpResourceType } from './outbox';

const uz = (k: Parameters<typeof translate>[1]) => translate('uz', k);

const settingsSchema = z.object({
  mode: z.enum(['off', 'export', 'live']).optional(),
  endpoint: z.string().trim().max(500).optional().nullable().transform((s) => (s === undefined ? undefined : s ? s : null)),
  token: z.string().trim().min(8).max(4000).optional(),   // write-only; absent = keep the stored one
  clear_token: z.boolean().optional(),
});

/** https only; plain http only to this machine outside production (tests and a local proxy). */
/**
 * The platform's own hosts only (dhp.uz and its subdomains, plus DHP_ALLOWED_HOSTS): a manager must not be able to point
 * the clinical outbox — with the token — at any other server. Plain http only for a local fake server outside production.
 */
export function endpointOk(u: string) {
  try {
    const url = new URL(u);
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol === 'http:') return config.mode !== 'production' && ['127.0.0.1', 'localhost', '[::1]'].includes(host);
    if (url.protocol !== 'https:') return false;
    const extra = (process.env.DHP_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    return host === 'dhp.uz' || host.endsWith('.dhp.uz') || extra.includes(host);
  } catch { return false; }
}

const STATUSES = ['pending', 'ready', 'sent', 'failed', 'skipped'] as const;
export const DHP_EXPORT_MAX_DAYS = 31;
const EXPORT_MAX_ROWS = 50_000;
/** 3 exports a minute per clinic: the file is a bulk copy of clinical records. */
const exportTimes = new Map<string, number[]>();
function takeSlot(tenantId: string, at = Date.now()) {
  const recent = (exportTimes.get(tenantId) ?? []).filter((t) => at - t < 60_000);
  if (recent.length >= 3) { exportTimes.set(tenantId, recent); return false; }
  recent.push(at); exportTimes.set(tenantId, recent); return true;
}
export function resetDhpExportSlots() { exportTimes.clear(); }

@Roles('manager')
@Controller('dhp')
export class DhpController {
  constructor(private db: Db) {}

  private async view(tenantId: string) {
    const s = await this.db.one(`SELECT mode, endpoint, token_enc IS NOT NULL AS has_token, last_error, last_error_at, last_sent_at, updated_at FROM dhp_settings WHERE tenant_id = $1`, [tenantId]);
    const counts = Object.fromEntries(STATUSES.map((k) => [k, 0])) as Record<(typeof STATUSES)[number], number>;
    for (const r of await this.db.rows(`SELECT status, count(*)::int AS n FROM dhp_outbox WHERE tenant_id = $1 GROUP BY status`, [tenantId])) counts[r.status as 'sent'] = r.n;
    const noPinfl = (await this.db.one(
      `SELECT count(*)::int AS n FROM dhp_outbox o JOIN patients p ON p.id = o.patient_id
        WHERE o.tenant_id = $1 AND o.status IN ('pending', 'ready', 'failed') AND p.pinfl IS NULL`, [tenantId]))!.n;
    return {
      mode: s?.mode ?? 'off', endpoint: s?.endpoint ?? null, has_token: !!s?.has_token,
      last_error: s?.last_error ?? null, last_error_at: s?.last_error_at ?? null, last_sent_at: s?.last_sent_at ?? null, updated_at: s?.updated_at ?? null,
      counts, without_pinfl: noPinfl, secrets_configured: secretsConfigured(), export_max_days: DHP_EXPORT_MAX_DAYS,
    };
  }

  @Get('settings')
  async settings(@CurrentCtx() ctx: Ctx) {
    return { data: await this.view(ctx.tenantId) };
  }

  /** Saves mode / endpoint / token. Live needs an endpoint and a stored token. The token is never returned or logged. */
  @Put('settings')
  async save(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(settingsSchema, body);
    if (input.endpoint && !endpointOk(input.endpoint)) throw invalid({ endpoint: uz('api.dhp.endpointHttps') });
    if (input.token !== undefined && !secretsConfigured()) throw coded(409, 'SECRETS_NOT_CONFIGURED', 'api.dhp.noSecrets');
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO dhp_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [ctx.tenantId]);
      const prev = (await c.query(`SELECT mode, endpoint, token_enc FROM dhp_settings WHERE tenant_id = $1 FOR UPDATE`, [ctx.tenantId])).rows[0];
      const mode = input.mode ?? prev.mode;
      const endpoint = input.endpoint !== undefined ? input.endpoint : prev.endpoint;
      // a new address never inherits the old token: the token goes only where the manager typed it together with the address
      const endpointChanged = input.endpoint !== undefined && input.endpoint !== prev.endpoint;
      const tokenEnc = input.token !== undefined ? encryptSecret(input.token) : (input.clear_token || endpointChanged) ? null : prev.token_enc;
      if (mode === 'live' && !endpoint) throw invalid({ endpoint: uz('api.dhp.liveNeedsEndpoint') });
      if (mode === 'live' && !tokenEnc) throw invalid({ token: uz('api.dhp.liveNeedsToken') });
      const tokenChanged = input.token !== undefined || ((!!input.clear_token || endpointChanged) && !!prev.token_enc);
      await c.query(
        `UPDATE dhp_settings SET mode = $2, endpoint = $3, token_enc = $4, updated_at = demo_now(),
                last_error = CASE WHEN $5 OR $3 IS DISTINCT FROM endpoint THEN NULL ELSE last_error END,
                last_error_at = CASE WHEN $5 OR $3 IS DISTINCT FROM endpoint THEN NULL ELSE last_error_at END
          WHERE tenant_id = $1`, [ctx.tenantId, mode, endpoint, tokenEnc, tokenChanged]);
      const changes = [mode !== prev.mode ? `rejim ${prev.mode} → ${mode}` : null, endpoint !== prev.endpoint ? 'manzil' : null, tokenChanged ? 'token' : null].filter(Boolean);
      if (changes.length) await audit(c, ctx, 'dhp.settings', 'dhp_settings', null, `DMED sozlamalari: ${changes.join(', ')}`);
    });
    return { data: await this.view(ctx.tenantId) };
  }

  /** Counts and the latest rows — identifiers, statuses and errors only, never the FHIR payload. */
  @Get('outbox')
  async outbox(@CurrentCtx() ctx: Ctx, @Query('status') status?: string) {
    if (status !== undefined && status !== '' && !(STATUSES as readonly string[]).includes(status)) throw invalid({ status: uz('api.dhp.badStatus') });
    const rows = await this.db.rows(
      `SELECT o.id, o.resource_type, o.resource_id, o.version, o.status, o.attempts, o.http_status, o.error, o.created_at, o.sent_at, o.next_attempt_at, p.patient_number
         FROM dhp_outbox o JOIN patients p ON p.id = o.patient_id
        WHERE o.tenant_id = $1 AND ($2::text IS NULL OR o.status = $2) ORDER BY o.created_at DESC LIMIT 100`, [ctx.tenantId, status || null]);
    const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]));
    for (const r of await this.db.rows(`SELECT status, count(*)::int AS n FROM dhp_outbox WHERE tenant_id = $1 GROUP BY status`, [ctx.tenantId])) counts[r.status] = r.n;
    return { data: rows, counts };
  }

  /**
   * The bundles of a period (≤ 31 days) as FHIR NDJSON — one Bundle per line — for a manual upload or the platform's
   * acceptance test. Clinical content: manager only, sealed download (the web never renders it), audited, 3/min.
   */
  @Get('export.ndjson')
  async exportNdjson(@CurrentCtx() ctx: Ctx, @Query('from') from: string, @Query('to') to: string, @Res({ passthrough: true }) res: Response) {
    const fields: Record<string, string> = {};
    if (!isDate(from)) fields.from = uz('api.dhp.dateRequired');
    if (!isDate(to)) fields.to = uz('api.dhp.dateRequired');
    if (Object.keys(fields).length) throw invalid(fields);
    if (to < from) throw invalid({ to: uz('api.dhp.dateOrder') });
    if (addDays(from, DHP_EXPORT_MAX_DAYS - 1) < to) throw invalid({ to: uz('api.dhp.periodTooLong') });
    if (!takeSlot(ctx.tenantId)) throw coded(429, 'EXPORT_RATE_LIMIT', 'api.dhp.rateLimit');
    const lines = await this.db.tx(async (c) => {
      const rows = (await c.query(
        `SELECT fhir FROM dhp_outbox
          WHERE tenant_id = $1 AND fhir IS NOT NULL AND status <> 'skipped'
            AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Tashkent') AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Tashkent')
          ORDER BY created_at, id LIMIT $4`, [ctx.tenantId, from, to, EXPORT_MAX_ROWS])).rows;
      await audit(c, ctx, 'dhp.export', 'dhp_outbox', null, `DMED eksporti: ${from} — ${to}, ${rows.length} ta to‘plam`);
      return rows.map((r) => JSON.stringify(r.fhir));
    });
    res.setHeader('Content-Type', 'application/fhir+ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="med-uz-ai-dhp-${from}_${to}.ndjson"`);
    res.setHeader('Cache-Control', 'no-store');
    return lines.length ? lines.join('\n') + '\n' : '';
  }

  /** A failed row is rebuilt from the current data (e.g. the PINFL added since) and queued again. */
  @Post('outbox/:id/retry') @HttpCode(200)
  async retry(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Yozuv');
    return this.db.tx(async (c) => {
      const o = (await c.query(`SELECT id, resource_type, resource_id, version, status FROM dhp_outbox WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!o) throw notFound('Yozuv');
      if (o.status !== 'failed') throw coded(409, 'INVALID_STATE', 'api.dhp.retryOnlyFailed');
      const mode = (await c.query(`SELECT mode FROM dhp_settings WHERE tenant_id = $1`, [ctx.tenantId])).rows[0]?.mode ?? 'off';
      if (mode === 'off') throw coded(409, 'DHP_OFF', 'api.dhp.off');
      let built;
      try { built = await buildDhpBundle(c, ctx.tenantId, o.resource_type as DhpResourceType, o.resource_id, o.version); } catch { built = null; }
      if (!built) throw coded(409, 'DHP_NOT_BUILDABLE', 'api.dhp.notBuildable');
      const row = (await c.query(
        `UPDATE dhp_outbox SET fhir = $2, status = 'pending', attempts = 0, error = NULL, http_status = NULL, next_attempt_at = demo_now() WHERE id = $1
         RETURNING id, resource_type, version, status, attempts, error, created_at`, [id, JSON.stringify(built.bundle)])).rows[0];
      await audit(c, ctx, 'dhp.retry', 'dhp_outbox', id, `DMED: qayta navbatga qo‘yildi (${o.resource_type})`);
      return { data: row };
    });
  }
}
