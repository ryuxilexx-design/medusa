// «Buyurtma taklifi» — the warehouse reorder suggestion (docs/WAREHOUSE.md): the table, its CSV export, and an
// optional AI brief (business route `warehouse_brief`, manager pattern: server numbers, number check).
import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { translate, type MessageKey } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, invalid } from '../core/errors';
import { parse } from '../core/validate';
import { audit } from '../core/audit';
import { branchScope } from '../core/scope';
import { assertCsvRows, csvSom, sendCsv } from '../core/csv';
import { now, today as todayStr } from '../core/clock';
import { AiClient } from '../ai/ai-client';
import { answerLanguage } from '../ai/lang';
import { checkItems, type Item } from '../ai/manager-facts';
import { BRIEF_SYSTEM, briefFacts, briefPayload, templateBrief } from '../ai/warehouse-brief';
import { HORIZON_DEFAULT, HORIZON_MAX, HORIZON_MIN, reorderRows } from './reorder';
import { reasonText } from './ai.controller';

const KEEPERS = ['storekeeper', 'manager'] as const;
/** CSV/print: at most this many rows (the suggestion of one clinic is far below it); more is refused, never cut (B7). */
export const REORDER_EXPORT_MAX = 1000;
/** Model calls of the brief per clinic and Tashkent day (B17, like the manager digest); a cached brief costs nothing. */
export const BRIEF_PER_DAY = 5;

function horizonOf(v: unknown): number {
  if (v === undefined || v === null || v === '') return HORIZON_DEFAULT;
  const h = Number(v);
  if (!Number.isInteger(h) || h < HORIZON_MIN || h > HORIZON_MAX) throw invalid({ horizon: 'Davr 7–180 kun bo‘lsin' });
  return h;
}

const itemZ = z.object({ text: z.string().max(400), fact_keys: z.array(z.string().max(64)).max(12) });
const briefZ = z.object({ bullets: z.array(itemZ).max(8) });
const BRIEF_SCHEMA = {
  type: 'object',
  properties: { bullets: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, fact_keys: { type: 'array', items: { type: 'string' } } }, required: ['text', 'fact_keys'], additionalProperties: false } } },
  required: ['bullets'], additionalProperties: false,
};
const briefBodyZ = z.object({ branch_id: z.string().uuid('Noto‘g‘ri identifikator').optional().nullable(), horizon: z.number().int().optional(), regenerate: z.boolean().optional() });

@Controller('warehouse')
export class ReorderController {
  constructor(private db: Db, private ai: AiClient) {}

  @Roles(...KEEPERS) @Get('reorder')
  async reorder(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const horizon = horizonOf(q.horizon);
    const r = await reorderRows(this.db, ctx.tenantId, branchScope(ctx, q.branch_id), horizon);
    const only = q.only === 'order';
    return { data: { ...r, rows: only ? r.rows.filter((x) => Number(x.suggested) > 0) : r.rows } };
  }

  /** The suggestion as CSV (a draft «Buyurtma so‘rovi» for the supplier — it creates no receipt). Rows to order only. */
  @Roles(...KEEPERS) @Get('reorder.csv')
  async reorderCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const horizon = horizonOf(q.horizon);
    const { today, rows } = await reorderRows(this.db, ctx.tenantId, branchScope(ctx, q.branch_id), horizon);
    const list = rows.filter((r) => Number(r.suggested) > 0);
    assertCsvRows(list.length, REORDER_EXPORT_MAX); // refused, never cut
    const L = ctx.locale;
    const h = (k: string) => translate(L, `wh.ro.csv.${k}` as MessageKey);
    const cost = list.reduce((a, r) => a + r.est_cost, 0); // integer tiyin
    sendCsv(res, `buyurtma-taklifi-${today}-${horizon}k.csv`,
      [h('item'), h('unit'), h('branch'), h('usable'), h('reserved'), h('rate'), h('daysLeft'), h('expiringUnusable'), h('minimum'), h('pack'), h('packs'), h('suggested'), h('price'), h('cost')],
      [...list.map((r) => [r.name, r.unit, r.branch_name, r.usable, r.reserved, r.daily_rate, r.days_left ?? '', r.expiring_unusable, r.minimum_qty, r.pack_size ?? '', r.packs ?? '', r.suggested,
        csvSom(r.purchase_price), csvSom(r.est_cost)]),
      [translate(L, 'wh.ro.total'), String(list.length), '', '', '', '', '', '', '', '', list.reduce((a, r) => a + (r.packs ?? 0), 0) || '', '', '', csvSom(cost)]]);
  }

  /**
   * A 3–5 bullet brief of the top items: the model words the server's numbers (live), or the template (off/sample).
   * Live: one brief per clinic, branch scope, horizon, day and language is kept (ai_digests) and returned again; a new
   * model call (first of the day or `regenerate`) is counted — at most BRIEF_PER_DAY per clinic and day (B17).
   */
  @Roles(...KEEPERS) @Post('reorder/brief') @HttpCode(200)
  async brief(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(briefBodyZ, body ?? {});
    const horizon = horizonOf(b.horizon);
    const branches = branchScope(ctx, b.branch_id);
    const mode = this.ai.managerMode(ctx.tenantId);
    if (mode !== 'live') {
      const { rows } = await reorderRows(this.db, ctx.tenantId, branches, horizon);
      const reason = mode === 'off' ? reasonText(ctx, this.ai.mode() === 'live' ? 'api.ai.freeTier' : this.ai.clinicalOffReason(ctx.tenantId) === 'api.ai.noKey' ? 'api.ai.noKey' : 'api.ai.offMode') : null;
      await audit(this.db.pool, ctx, 'ai.warehouse_brief', 'ai', null, 'Buyurtma taklifi xulosasi (shablon)');
      return { data: { mode, source: 'template', cached: false, horizon, bullets: templateBrief(ctx.locale, rows, horizon).map((x) => ({ text: x.text, fact_keys: x.fact_keys })),
        dropped: 0, model: null, reason, generated_at: now().toISOString(), runs_left: null } };
    }
    const day = todayStr();
    const scopeKey = `warehouse_brief:${horizon}:${[...branches].sort().join(',')}`;
    const out = await this.db.tx(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ai_digest:${ctx.tenantId}:${scopeKey}:${day}:${ctx.locale}`]);
      if (!b.regenerate) {
        const hit = (await c.query(`SELECT digest, model, dropped, generated_at FROM ai_digests WHERE tenant_id = $1 AND scope_key = $2 AND day = $3 AND locale = $4`,
          [ctx.tenantId, scopeKey, day, ctx.locale])).rows[0];
        if (hit) return { mode, source: hit.digest.source as 'model' | 'template', cached: true, horizon, bullets: hit.digest.bullets as Item[], dropped: hit.dropped, model: hit.model,
          reason: null, generated_at: new Date(hit.generated_at).toISOString() };
      }
      // the limit counts attempts (a failed model call costs too)
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('ai_digest_runs:wh:' || $1))`, [ctx.tenantId]);
      const n = (await c.query(`SELECT count(*)::int AS n FROM ai_digest_runs WHERE tenant_id = $1 AND kind = 'warehouse_brief'
          AND created_at >= date_trunc('day', (SELECT demo_now()) AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'`, [ctx.tenantId])).rows[0].n;
      if (n >= BRIEF_PER_DAY) throw coded(429, 'AI_BRIEF_LIMIT', 'wh.ro.briefLimit', { n: BRIEF_PER_DAY });
      await this.db.pool.query(`INSERT INTO ai_digest_runs (tenant_id, membership_id, kind) VALUES ($1, $2, 'warehouse_brief')`, [ctx.tenantId, ctx.membershipId]);
      const { rows } = await reorderRows(this.db, ctx.tenantId, branches, horizon);
      const facts = briefFacts(rows, horizon);
      let bullets: Item[], source: 'model' | 'template' = 'template', dropped = 0, model: string | null = null;
      try {
        const { value, model: m } = await this.ai.json({
          route: 'warehouse_brief', system: `${BRIEF_SYSTEM}\n${answerLanguage(ctx.locale)}`, user: JSON.stringify(briefPayload(rows, facts)),
          schema: BRIEF_SCHEMA, validate: briefZ, effort: 'low', maxTokens: 1500, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
        });
        const chk = checkItems(value.bullets, facts, 5);
        dropped = chk.dropped; model = m;
        if (chk.kept.length) { bullets = chk.kept; source = 'model'; } else bullets = templateBrief(ctx.locale, rows, horizon);
      } catch (e) {
        // the model failed: the template answers now, nothing is kept (the next call tries again)
        return { mode, source: 'template' as const, cached: false, horizon, bullets: templateBrief(ctx.locale, rows, horizon), dropped: 0, model: null,
          reason: e instanceof AppError && e.key ? translate(ctx.locale, e.key, e.params) : translate(ctx.locale, 'api.ai.unexpected'), generated_at: now().toISOString() };
      }
      const row = (await c.query(
        `INSERT INTO ai_digests (tenant_id, scope_key, branch_ids, day, locale, facts, digest, model, dropped, generated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id, scope_key, day, locale) DO UPDATE SET facts = EXCLUDED.facts, digest = EXCLUDED.digest, model = EXCLUDED.model,
           dropped = EXCLUDED.dropped, generated_by = EXCLUDED.generated_by, generated_at = demo_now()
         RETURNING generated_at`,
        [ctx.tenantId, scopeKey, branches, day, ctx.locale, JSON.stringify(facts), JSON.stringify({ bullets, source }), model, dropped, ctx.membershipId])).rows[0];
      return { mode, source, cached: false, horizon, bullets, dropped, model, reason: null, generated_at: new Date(row.generated_at).toISOString() };
    });
    const used = (await this.db.one(`SELECT count(*)::int AS n FROM ai_digest_runs WHERE tenant_id = $1 AND kind = 'warehouse_brief'
        AND created_at >= date_trunc('day', (SELECT demo_now()) AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'`, [ctx.tenantId]))!.n;
    if (!out.cached) await audit(this.db.pool, ctx, 'ai.warehouse_brief', 'ai', null, out.source === 'model' ? `Buyurtma taklifi xulosasi (AI, ${out.model})` : 'Buyurtma taklifi xulosasi (shablon)');
    return { data: { ...out, bullets: out.bullets.map((x) => ({ text: x.text, fact_keys: x.fact_keys })), runs_left: Math.max(0, BRIEF_PER_DAY - used) } };
  }
}
