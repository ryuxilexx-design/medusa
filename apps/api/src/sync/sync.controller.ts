// «Integratsiyalar → MedPlus» (docs/MEDPLUS_SYNC.md).
//  - POST /integrations/:sourceId/batch — the bridge on the clinic PC; no session, a per-source bearer token (only its
//    SHA-256 is stored, shown once at creation like a camera's push token), rate-limited, audited as «system».
//  - everything else: the manager only (sources, token, status, mappings, duplicates, pending, log, reconciliation,
//    file import). Another clinic's source is 404.
import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Public, Roles } from '../core/context';
import { AppError, coded, conflict, invalid, notFound } from '../core/errors';
import { hashToken } from '../core/guard';
import { isDate, isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, now, today } from '../core/clock';
import { periodFits } from '../core/csv';
import { TableReadError } from '../core/xlsx';
import { batchSchema } from './records';
import { RecordResult, retryPending, runBatch, Source, systemCtx } from './ingest';
import { cutover, cutoverPreview, sourceClosed } from './cutover';
import { IMPORT_FIELDS, IMPORT_KINDS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, ImportKind, prepareRecords, PREVIEW_ROWS, readImport } from './file-import';

/** Largest JSON body of a bridge batch (express.json on this route only, see app.ts). */
export const SYNC_BODY_LIMIT = '5mb';
/** Batches per source per minute, and failed token checks per address per minute. */
const BATCH_PER_MIN = 120;
const BAD_AUTH_PER_MIN = 20;

const newToken = () => 'mps_' + randomBytes(32).toString('base64url');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A tiny fixed-window counter (per process; enough for one bridge per clinic). */
class Window {
  private m = new Map<string, { start: number; n: number }>();
  constructor(private limit: number) {}
  hit(key: string): boolean {
    const t = Date.now(); const w = this.m.get(key);
    if (!w || t - w.start >= 60_000) { this.m.set(key, { start: t, n: 1 }); if (this.m.size > 10_000) this.m.clear(); return true; }
    return ++w.n <= this.limit;
  }
}
const batches = new Window(BATCH_PER_MIN);
const badAuth = new Window(BAD_AUTH_PER_MIN);

// multer ships with @nestjs/platform-express; memory storage only — the file is parsed and dropped, never stored
// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer: any = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 6, fieldSize: 4000, parts: 8 } }).single('file');
export function readUpload(req: Request, res: Response): Promise<{ file?: { buffer: Buffer; size: number; originalname: string }; body: Record<string, string> }> {
  return new Promise((resolve, reject) => upload(req, res, (err: any) => {
    if (!err) return resolve({ file: (req as any).file, body: { ...((req as any).body ?? {}) } });
    if (err.code === 'LIMIT_FILE_SIZE') return reject(coded(413, 'FILE_TOO_LARGE', 'api.sync.fileTooLarge', { mb: IMPORT_MAX_BYTES / 1024 / 1024 }));
    reject(invalid({ file: 'Fayl noto‘g‘ri yuborildi' }));
  }));
}

const sourceCreateSchema = z.object({ name: z.string().trim().min(1, 'Nomini kiriting').max(80).default('MedPlus') });
const sourcePatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  default_branch_id: z.string().uuid().nullable().optional(),
});
const mappingPatchSchema = z.object({ target_id: z.string().uuid().nullable().optional(), target_code: z.enum(['cash', 'card', 'transfer']).nullable().optional() });

const SOURCE_COLS = `s.id, s.kind, s.name, s.active, s.last_seen_at, s.last_batch_at, s.last_cursor, s.settings, s.created_at, s.created_by_name, (s.token_hash IS NOT NULL) AS has_token,
  s.cutover_at, s.cutover_by_name, s.cutover_counts`;
const cutoverSchema = z.object({ confirm: z.literal(true, { errorMap: () => ({ message: 'Tasdiqlang' }) }), discard_pending: z.boolean().default(false) });

@Controller('integrations')
export class IntegrationsController {
  constructor(private db: Db) {}

  // ---------------------------------------------------------------- the bridge

  @Public() @Post(':sourceId/batch') @HttpCode(200)
  async batch(@Param('sourceId') sourceId: string, @Headers('authorization') auth: string | undefined, @Body() body: unknown, @Req() req: Request) {
    const ip = String(req.ip ?? '');
    const m = /^Bearer\s+(mps_[A-Za-z0-9_-]{43})$/.exec(auth ?? '');
    const src = m && isUuid(sourceId) ? await this.db.one<Source & { token_hash: string | null; active: boolean; tenant_status: string }>(
      `SELECT s.id, s.tenant_id, s.kind, s.name, s.settings, s.token_hash, s.active, t.status AS tenant_status FROM external_sources s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1`, [sourceId]) : undefined;
    if (!src || !src.token_hash || !sameHash(src.token_hash, hashToken(m![1])) || !src.active || src.tenant_status !== 'active') {
      if (!badAuth.hit(ip)) throw coded(429, 'RATE_LIMITED', 'api.sync.rateLimited');
      throw coded(401, 'UNAUTHENTICATED', 'api.sync.badToken');
    }
    if (!batches.hit(src.id)) throw coded(429, 'RATE_LIMITED', 'api.sync.rateLimited');
    const input = parse(batchSchema, body);
    await this.db.rows(`UPDATE external_sources SET last_seen_at = $2 WHERE id = $1`, [src.id, now()]);
    const ctx = systemCtx(src, (req as any).requestId);
    const r = await runBatch(this.db, src, input.records, { channel: 'bridge', actor: src.name, ctx, cursor: input.cursor });
    return { data: r };
  }

  // ---------------------------------------------------------------- sources

  /**
   * MedPlus mirrors the whole clinic (every branch's patients, money, reconciliation), so only a manager whose
   * branch scope covers every active branch manages it; a branch-limited manager gets 403.
   */
  private async assertWholeClinic(ctx: Ctx) {
    const outside = (await this.db.one(`SELECT count(*)::int AS n FROM branches WHERE tenant_id = $1 AND active AND NOT (id = ANY($2::uuid[]))`, [ctx.tenantId, ctx.branchIds]))!.n;
    if (outside > 0) throw coded(403, 'FORBIDDEN', 'api.sync.allBranches');
  }

  private async source(ctx: Ctx, id: string): Promise<Source & { active: boolean }> {
    await this.assertWholeClinic(ctx);
    if (!isUuid(id)) throw notFound('Integratsiya');
    const s = await this.db.one(`SELECT id, tenant_id, kind, name, settings, active, cutover_at FROM external_sources WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
    if (!s) throw notFound('Integratsiya');
    return s as any;
  }
  /** A source still in use (not switched off for good). */
  private async openSource(ctx: Ctx, id: string) {
    const s = await this.source(ctx, id);
    if ((s as any).cutover_at) throw sourceClosed();
    return s;
  }

  @Roles('manager') @Get('sources')
  async sources(@CurrentCtx() ctx: Ctx) {
    await this.assertWholeClinic(ctx);
    return { data: await this.db.rows(`SELECT ${SOURCE_COLS} FROM external_sources s WHERE s.tenant_id = $1 ORDER BY s.created_at`, [ctx.tenantId]) };
  }

  /** Connects MedPlus: one source per clinic. The bridge token is returned here once and never again. */
  @Roles('manager') @Post('sources') @HttpCode(201)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    await this.assertWholeClinic(ctx);
    const input = parse(sourceCreateSchema, body ?? {});
    const token = newToken();
    return this.db.tx(async (c) => {
      if ((await c.query(`SELECT 1 FROM external_sources WHERE tenant_id = $1 AND kind = 'medplus'`, [ctx.tenantId])).rowCount) throw coded(409, 'SOURCE_EXISTS', 'api.sync.sourceExists', { mp: 'MedPlus' });
      const s = (await c.query(
        `INSERT INTO external_sources (tenant_id, kind, name, token_hash, created_by_name, created_at) VALUES ($1, 'medplus', $2, $3, $4, $5) RETURNING id`,
        [ctx.tenantId, input.name, hashToken(token), ctx.name, now()])).rows[0];
      await audit(c, ctx, 'sync.source_create', 'external_source', s.id, `MedPlus ulandi: ${input.name}`);
      const row = (await c.query(`SELECT ${SOURCE_COLS} FROM external_sources s WHERE s.id = $1`, [s.id])).rows[0];
      return { data: { ...row, token } };
    });
  }

  /** A new bridge token (the old one stops working at once). Shown once. */
  @Roles('manager') @Post('sources/:id/token') @HttpCode(200)
  async rotate(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const src = await this.openSource(ctx, id);
    const token = newToken();
    await this.db.tx(async (c) => {
      await c.query(`UPDATE external_sources SET token_hash = $2 WHERE id = $1`, [src.id, hashToken(token)]);
      await audit(c, ctx, 'sync.token', 'external_source', src.id, 'MedPlus ko‘prigi uchun yangi kalit berildi');
    });
    return { data: { id: src.id, token } };
  }

  @Roles('manager') @Patch('sources/:id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const src = await this.openSource(ctx, id);
    const input = parse(sourcePatchSchema, body ?? {});
    if (input.default_branch_id && !(await this.db.one(`SELECT 1 FROM branches WHERE id = $1 AND tenant_id = $2`, [input.default_branch_id, ctx.tenantId])))
      throw invalid({ default_branch_id: 'Filial topilmadi' });
    await this.db.tx(async (c) => {
      const settings = { ...(src.settings ?? {}), ...(input.default_branch_id !== undefined ? { default_branch_id: input.default_branch_id } : {}) };
      await c.query(`UPDATE external_sources SET name = coalesce($2, name), active = coalesce($3, active), settings = $4 WHERE id = $1`,
        [src.id, input.name ?? null, input.active ?? null, JSON.stringify(settings)]);
      const what = [input.active === false ? 'to‘xtatildi' : input.active === true ? 'yoqildi' : null, input.name ? 'nomi o‘zgardi' : null, input.default_branch_id !== undefined ? 'asosiy filial tanlandi' : null].filter(Boolean).join(', ');
      await audit(c, ctx, 'sync.source_update', 'external_source', src.id, `MedPlus: ${what || 'sozlamalar'}`);
    });
    if (input.default_branch_id) await retryPending(this.db, { ...src, settings: { ...(src.settings ?? {}), default_branch_id: input.default_branch_id } }, ctx.name);
    return { data: { ok: true } };
  }

  /** The status card: what is mirrored, what waits, what needs the manager. */
  @Roles('manager') @Get('sources/:id/status')
  async status(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const src = await this.source(ctx, id);
    const counts = await this.db.rows(`SELECT kind, count(*)::int AS n FROM external_refs WHERE source_id = $1 AND kind IN ('patient','visit','order','payment','refund') GROUP BY 1`, [src.id]);
    const money = (await this.db.one(`SELECT coalesce(sum(amount),0)::bigint AS s, count(*)::int AS n FROM payments WHERE external_source_id = $1`, [src.id]))!;
    const pending = await this.db.rows(`SELECT reason, count(*)::int AS n FROM external_pending WHERE source_id = $1 GROUP BY 1 ORDER BY 2 DESC`, [src.id]);
    const review = await this.db.rows(`SELECT kind, count(*)::int AS n FROM external_mappings WHERE source_id = $1 AND (status = 'auto' OR (target_id IS NULL AND target_code IS NULL AND kind <> 'staff')) GROUP BY 1`, [src.id]);
    const dups = (await this.db.one(`SELECT count(*)::int AS n FROM external_duplicates WHERE source_id = $1 AND status = 'open'`, [src.id]))!.n;
    const errors = (await this.db.one(`SELECT coalesce(sum(errors),0)::int AS n FROM external_sync_log WHERE source_id = $1 AND finished_at > $2::timestamptz - interval '1 day'`, [src.id, now()]))!.n;
    const last = await this.db.one(`SELECT channel, received, created, updated, unchanged, parked, skipped, errors, finished_at FROM external_sync_log WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [src.id]);
    const by = Object.fromEntries(counts.map((r) => [r.kind, r.n]));
    return { data: {
      counts: { patients: by.patient ?? 0, visits: by.visit ?? 0, orders: by.order ?? 0, payments: money.n, payments_sum: Number(money.s), refunds: by.refund ?? 0 },
      pending, pending_total: pending.reduce((a, r) => a + r.n, 0), review: Object.fromEntries(review.map((r) => [r.kind, r.n])), duplicates: dups, errors_24h: errors, last: last ?? null,
    } };
  }

  // ---------------------------------------------------------------- the switch (migration 044)

  /** What «O‘tishni yakunlash» would turn into ordinary Med.uz.ai rows, and what still waits. */
  @Roles('manager') @Get('sources/:id/cutover')
  async cutoverInfo(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const src = await this.source(ctx, id);
    if ((src as any).cutover_at) {
      const row = (await this.db.one(`SELECT cutover_at, cutover_by_name, cutover_counts FROM external_sources WHERE id = $1`, [src.id]))!;
      return { data: { done: true, ...row } };
    }
    return { data: { done: false, counts: await cutoverPreview(this.db, src) } };
  }

  /** The clinic leaves MedPlus: once, final. */
  @Roles('manager') @Post('sources/:id/cutover') @HttpCode(200)
  async cutoverRun(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const src = await this.openSource(ctx, id);
    const input = parse(cutoverSchema, body ?? {});
    return { data: await cutover(this.db, src, ctx, { discardPending: input.discard_pending }) };
  }

  // ---------------------------------------------------------------- mappings

  @Roles('manager') @Get('sources/:id/mappings')
  async mappings(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    const src = await this.source(ctx, id);
    const { page, pageSize, offset } = pageParams(q);
    const kind = ['branch', 'service', 'doctor', 'method', 'staff'].includes(q.kind) ? q.kind : 'service';
    const P: unknown[] = [src.id, kind];
    let where = `m.source_id = $1 AND m.kind = $2`;
    if (q.review === '1') where += ` AND m.status = 'auto'`;
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM external_mappings m WHERE ${where}`, P))!.n;
    const rows = await this.db.rows(
      `SELECT m.id, m.kind, m.external_id, m.external_name, m.target_id, m.target_code, m.placeholder, m.status, m.confirmed_by_name, m.confirmed_at,
              CASE m.kind WHEN 'branch' THEN (SELECT name FROM branches WHERE id = m.target_id)
                          WHEN 'service' THEN (SELECT name FROM services WHERE id = m.target_id)
                          WHEN 'doctor' THEN (SELECT display_name FROM doctors WHERE id = m.target_id)
                          WHEN 'staff' THEN (SELECT u.full_name FROM memberships ms JOIN users u ON u.id = ms.user_id WHERE ms.id = m.target_id) END AS target_name
         FROM external_mappings m WHERE ${where} ORDER BY (m.status = 'auto') DESC, m.external_name NULLS LAST, m.external_id LIMIT $3 OFFSET $4`, [...P, pageSize, offset]);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  /** What a MedPlus reference can be mapped to: our real branches, services, doctors, staff (sync placeholders excluded). */
  @Roles('manager') @Get('sources/:id/targets')
  async targets(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('kind') kind: string) {
    const src = await this.source(ctx, id);
    const notStub = `NOT EXISTS (SELECT 1 FROM external_mappings x WHERE x.source_id = $2 AND x.placeholder AND x.target_id = t.id)`;
    const sql: Record<string, string> = {
      branch: `SELECT t.id, t.name FROM branches t WHERE t.tenant_id = $1 AND $2::uuid IS NOT NULL ORDER BY t.name`,
      service: `SELECT t.id, t.name FROM services t WHERE t.tenant_id = $1 AND ${notStub} ORDER BY t.active DESC, t.name LIMIT 1000`,
      doctor: `SELECT t.id, t.display_name AS name FROM doctors t WHERE t.tenant_id = $1 AND ${notStub} ORDER BY t.active DESC, t.display_name LIMIT 500`,
      staff: `SELECT m.id, u.full_name AS name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 AND m.status = 'active' AND $2::uuid IS NOT NULL ORDER BY u.full_name LIMIT 500`,
    };
    if (!sql[kind]) return { data: [] };
    return { data: await this.db.rows(sql[kind], [ctx.tenantId, src.id]) };
  }

  /** The manager confirms or changes a mapping. Future records follow it; mirrored rows keep their snapshot. Waiting records retry. */
  @Roles('manager') @Patch('sources/:id/mappings/:mid')
  async setMapping(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('mid') mid: string, @Body() body: unknown) {
    const src = await this.source(ctx, id);
    if (!isUuid(mid)) throw notFound('Moslik');
    const input = parse(mappingPatchSchema, body ?? {});
    await this.db.tx(async (c) => {
      const m = (await c.query(`SELECT * FROM external_mappings WHERE id = $1 AND source_id = $2 FOR UPDATE`, [mid, src.id])).rows[0];
      if (!m) throw notFound('Moslik');
      let targetId = m.target_id, code = m.target_code, placeholder = m.placeholder;
      if (m.kind === 'method') {
        if (input.target_code === undefined) throw invalid({ target_code: 'To‘lov usulini tanlang' });
        code = input.target_code;
      } else if (input.target_id !== undefined) {
        const table: Record<string, string> = { branch: 'branches', service: 'services', doctor: 'doctors', staff: 'memberships' };
        if (input.target_id === null) { if (m.kind !== 'staff') throw invalid({ target_id: 'Tanlang' }); targetId = null; }
        else {
          if (!(await c.query(`SELECT 1 FROM ${table[m.kind]} WHERE id = $1 AND tenant_id = $2`, [input.target_id, ctx.tenantId])).rowCount) throw invalid({ target_id: 'Topilmadi' });
          if (input.target_id !== m.target_id) placeholder = false;
          targetId = input.target_id;
        }
      }
      if (m.kind !== 'method' && m.kind !== 'staff' && !targetId) throw invalid({ target_id: 'Tanlang' });
      await c.query(`UPDATE external_mappings SET target_id = $2, target_code = $3, placeholder = $4, status = 'confirmed', confirmed_by_name = $5, confirmed_at = $6 WHERE id = $1`,
        [mid, targetId, code, placeholder, ctx.name, now()]);
      await audit(c, ctx, 'sync.mapping', 'external_mapping', mid, `MedPlus moslik tasdiqlandi: ${m.kind} ${String(m.external_name ?? m.external_id).slice(0, 80)}`);
    });
    const applied = await retryPending(this.db, src, ctx.name);
    return { data: { ok: true, applied_pending: applied } };
  }

  // ---------------------------------------------------------------- duplicates, pending, log

  @Roles('manager') @Get('sources/:id/duplicates')
  async duplicates(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    const src = await this.source(ctx, id);
    const { page, pageSize, offset } = pageParams(q);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM external_duplicates WHERE source_id = $1 AND status = 'open'`, [src.id]))!.n;
    const rows = await this.db.rows(
      `SELECT d.id, d.reason, d.created_at, p.id AS patient_id, p.patient_number, p.last_name, p.first_name, p.birth_date, p.phone,
              (SELECT json_agg(json_build_object('id', c.id, 'patient_number', c.patient_number, 'last_name', c.last_name, 'first_name', c.first_name, 'birth_date', c.birth_date, 'phone', c.phone) ORDER BY c.patient_number)
                 FROM patients c WHERE c.id = ANY(d.candidate_ids) AND c.tenant_id = d.tenant_id) AS candidates
         FROM external_duplicates d JOIN patients p ON p.id = d.patient_id
        WHERE d.source_id = $1 AND d.status = 'open' ORDER BY d.created_at DESC LIMIT $2 OFFSET $3`, [src.id, pageSize, offset]);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  /** «Reviewed»: the manager looked at the pair (cards are never merged automatically). */
  @Roles('manager') @Post('sources/:id/duplicates/:did/review') @HttpCode(200)
  async reviewDuplicate(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('did') did: string) {
    const src = await this.source(ctx, id);
    if (!isUuid(did)) throw notFound('Dublikat');
    await this.db.tx(async (c) => {
      const r = (await c.query(`UPDATE external_duplicates SET status = 'reviewed', reviewed_by_name = $3, reviewed_at = $4 WHERE id = $1 AND source_id = $2 AND status = 'open' RETURNING patient_id`, [did, src.id, ctx.name, now()])).rows[0];
      if (!r) throw notFound('Dublikat');
      await audit(c, ctx, 'sync.duplicate_review', 'patient', r.patient_id, 'MedPlus: ehtimoliy dublikat ko‘rib chiqildi');
    });
    return { data: { ok: true } };
  }

  /** Waiting records: kind, MedPlus id, why — never the record's personal data. */
  @Roles('manager') @Get('sources/:id/pending')
  async pending(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    const src = await this.source(ctx, id);
    const { page, pageSize, offset } = pageParams(q);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM external_pending WHERE source_id = $1`, [src.id]))!.n;
    const rows = await this.db.rows(`SELECT id, kind, external_id, reason, attempts, first_seen_at, last_tried_at FROM external_pending WHERE source_id = $1 ORDER BY first_seen_at LIMIT $2 OFFSET $3`, [src.id, pageSize, offset]);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  @Roles('manager') @Get('sources/:id/log')
  async log(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    const src = await this.source(ctx, id);
    const { page, pageSize, offset } = pageParams(q);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM external_sync_log WHERE source_id = $1`, [src.id]))!.n;
    const rows = await this.db.rows(
      `SELECT id, channel, actor_name, received, created, updated, unchanged, parked, skipped, errors, applied_pending, error_samples, started_at, finished_at
         FROM external_sync_log WHERE source_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`, [src.id, pageSize, offset]);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  /**
   * Daily reconciliation: MedPlus's own totals (sent by the bridge, per day and branch) next to what Med.uz.ai mirrored
   * — payments minus refunds of that day, cash basis. A difference means a record is waiting or failed.
   */
  @Roles('manager') @Get('sources/:id/reconciliation')
  async reconciliation(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    const src = await this.source(ctx, id);
    const to = isDate(q.to) ? q.to : today();
    const from = isDate(q.from) ? q.from : addDays(to, -6);
    if (!periodFits(from, to) || to > addDays(from, 92)) throw invalid({ from: 'Davr 93 kundan oshmasin' });
    const start = dayStart(from), end = dayStart(addDays(to, 1));
    const ours = await this.db.rows(
      `WITH pay AS (SELECT (paid_at AT TIME ZONE 'Asia/Tashkent')::date::text AS day, branch_id, sum(amount)::bigint AS s, count(*)::int AS n FROM payments
                     WHERE tenant_id = $1 AND external_source_id = $2 AND paid_at >= $3 AND paid_at < $4 GROUP BY 1, 2),
            ref AS (SELECT (refunded_at AT TIME ZONE 'Asia/Tashkent')::date::text AS day, branch_id, sum(amount)::bigint AS s FROM refunds
                     WHERE tenant_id = $1 AND external_source_id = $2 AND refunded_at >= $3 AND refunded_at < $4 GROUP BY 1, 2)
       SELECT coalesce(pay.day, ref.day) AS day, coalesce(pay.branch_id, ref.branch_id) AS branch_id, (coalesce(pay.s,0) - coalesce(ref.s,0))::bigint AS sum, coalesce(pay.n,0)::int AS count
         FROM pay FULL JOIN ref ON ref.day = pay.day AND ref.branch_id = pay.branch_id`, [ctx.tenantId, src.id, start, end]);
    const reported = await this.db.rows(
      `SELECT t.day::text AS day, t.branch_external_id, t.payments_sum, t.payments_count, t.patients_total, t.received_at, m.target_id AS branch_id
         FROM external_daily_totals t LEFT JOIN external_mappings m ON m.source_id = t.source_id AND m.kind = 'branch' AND m.external_id = t.branch_external_id
        WHERE t.source_id = $1 AND t.day BETWEEN $2 AND $3`, [src.id, from, to]);
    const branches = await this.db.rows(`SELECT id, name FROM branches WHERE tenant_id = $1 ORDER BY name`, [ctx.tenantId]);
    const name = new Map(branches.map((b) => [b.id, b.name]));
    const dayStr = (d: unknown) => String(d).slice(0, 10);
    const key = (day: string, b: string | null) => `${day}|${b ?? ''}`;
    const rows = new Map<string, any>();
    const row = (day: string, b: string | null) => {
      const k = key(day, b);
      if (!rows.has(k)) rows.set(k, { day, branch_id: b, branch_name: b ? name.get(b) ?? null : null, reported_sum: null, reported_count: null, our_sum: 0, our_count: 0 });
      return rows.get(k);
    };
    // a total MedPlus sent for the whole clinic (no branch) is compared with all branches together
    const clinicWide = new Set(reported.filter((r) => !r.branch_external_id).map((r) => dayStr(r.day)));
    for (const r of reported) { const x = row(dayStr(r.day), r.branch_external_id ? r.branch_id ?? null : null); x.reported_sum = (x.reported_sum ?? 0) + Number(r.payments_sum); x.reported_count = (x.reported_count ?? 0) + r.payments_count; }
    for (const o of ours) { const d = dayStr(o.day); const x = row(d, clinicWide.has(d) ? null : o.branch_id); x.our_sum += Number(o.sum); x.our_count += o.count; }
    const list = [...rows.values()].map((x) => ({ ...x, diff_sum: x.reported_sum == null ? null : x.reported_sum - x.our_sum, diff_count: x.reported_count == null ? null : x.reported_count - x.our_count }))
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : String(a.branch_name ?? '').localeCompare(String(b.branch_name ?? ''))));
    const patients = (await this.db.one(
      `SELECT (SELECT count(*)::int FROM external_refs WHERE source_id = $1 AND kind = 'patient') AS ours,
              (SELECT sum(patients_total)::int FROM external_daily_totals WHERE source_id = $1 AND day = (SELECT max(day) FROM external_daily_totals WHERE source_id = $1 AND patients_total IS NOT NULL)) AS reported`, [src.id]))!;
    return { data: { from, to, rows: list, patients: { ours: patients.ours, reported: patients.reported } } };
  }

  // ---------------------------------------------------------------- file import

  /** Step 1: read the file, find the header row, guess the columns. Nothing is stored. */
  @Roles('manager') @Post('sources/:id/import/preview') @HttpCode(200)
  async importPreview(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.openSource(ctx, id);
    const { file, body } = await readUpload(req, res);
    const kind = this.kind(body.kind);
    const parsed = this.read(file, kind);
    const sample = parsed.table.slice(parsed.headerRow + 1, parsed.headerRow + 6).map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 16).replace('T', ' ').replace(' 00:00', '') : c)));
    const rows = parsed.table.length - parsed.headerRow - 1;
    return { data: { kind, header_row: parsed.headerRow + 1, headers: parsed.headers, guess: parsed.guess, sample, rows, fields: IMPORT_FIELDS[kind].map((f) => ({ key: f.key, required: !!f.required })) } };
  }

  /** Step 2: dry run (dry_run=1, the first PREVIEW_ROWS rows) or the import itself — through the bridge's upsert path. */
  @Roles('manager') @Post('sources/:id/import') @HttpCode(200)
  async importFile(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const src = await this.openSource(ctx, id);
    const { file, body } = await readUpload(req, res);
    const kind = this.kind(body.kind);
    const dry = body.dry_run === '1' || body.dry_run === 'true';
    const parsed = this.read(file, kind);
    let mapping: Record<string, number> = parsed.guess;
    if (body.mapping) {
      try {
        const m = JSON.parse(body.mapping);
        mapping = Object.fromEntries(Object.entries(m).filter(([k, v]) => IMPORT_FIELDS[kind].some((f) => f.key === k) && Number.isInteger(v) && (v as number) >= -1 && (v as number) < 500)) as Record<string, number>;
      } catch { throw invalid({ mapping: 'Ustunlar noto‘g‘ri' }); }
    }
    const missing = IMPORT_FIELDS[kind].filter((f) => f.required && (mapping[f.key] === undefined || mapping[f.key] < 0)).map((f) => f.key);
    if (missing.length) throw new AppError(422, 'VALIDATION', 'Maydonlarni tekshiring', Object.fromEntries(missing.map((k) => [k, 'Ustunni tanlang'])));
    const prep = prepareRecords(parsed.table, kind, mapping, parsed.headerRow, dry ? PREVIEW_ROWS : undefined);
    if (prep.total > IMPORT_MAX_ROWS) throw coded(413, 'FILE_TOO_LARGE', 'api.sync.tooManyRows', { n: '30 000' });
    const result = await this.runChunks(src, ctx, prep.records, dry);
    const rowErrors = [...prep.errors, ...(result.results as RecordResult[]).filter((x) => x.outcome === 'error' || x.outcome === 'parked')
      .map((x) => ({ row: prep.rowOf.get(x.external_id) ?? 0, code: x.code ?? x.outcome, outcome: x.outcome }))].sort((a, b) => a.row - b.row);
    const { results: _drop, ...counts } = result;
    return { data: { ...counts, dry_run: dry, total_rows: prep.total, checked_rows: prep.records.length + prep.errors.length, file_errors: prep.errors.length, row_errors: rowErrors.slice(0, 200) } };
  }

  private kind(k: unknown): ImportKind {
    if (!IMPORT_KINDS.includes(k as ImportKind)) throw invalid({ kind: 'Turini tanlang' });
    return k as ImportKind;
  }
  private read(file: { buffer: Buffer; size: number } | undefined, kind: ImportKind) {
    if (!file || !file.size) throw invalid({ file: 'Faylni tanlang' });
    try { return readImport(file.buffer, kind); } catch (e) {
      if (e instanceof TableReadError) throw e.code === 'XLS_OLD' ? coded(422, 'XLS_OLD', 'api.sync.xlsOld', { app: 'Excel', fmt: 'XLSX' }) : coded(422, 'BAD_FILE', 'api.sync.badFile');
      throw e;
    }
  }
  /** A dry run is one rolled-back transaction; an import commits in chunks of 1000 records (one sync log row each). */
  private async runChunks(src: Source, ctx: Ctx, records: unknown[], dry: boolean) {
    if (dry) return runBatch(this.db, src, records, { channel: 'file', actor: ctx.name, ctx, dryRun: true, withResults: true }) as Promise<any>;
    const total: any = { received: 0, created: 0, updated: 0, unchanged: 0, parked: 0, skipped: 0, errors: 0, applied_pending: 0, error_samples: [], results: [] };
    for (let i = 0; i < records.length || i === 0; i += 1000) {
      const r = await runBatch(this.db, src, records.slice(i, i + 1000), { channel: 'file', actor: ctx.name, ctx, withResults: true });
      for (const k of ['received', 'created', 'updated', 'unchanged', 'parked', 'skipped', 'errors', 'applied_pending']) total[k] += (r as any)[k];
      total.error_samples.push(...r.error_samples); total.results.push(...(r.results ?? []));
      if (!records.length) break;
    }
    total.error_samples = total.error_samples.slice(0, 20);
    return total;
  }
}
