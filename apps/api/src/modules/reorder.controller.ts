// «Buyurtma taklifi» — the warehouse reorder suggestion (docs/WAREHOUSE.md): the table, its CSV export, and an
// optional AI brief (business route `warehouse_brief`, manager pattern: server numbers, number check).
import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { translate, type MessageKey } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, invalid } from '../core/errors';
import { parse } from '../core/validate';
import { audit } from '../core/audit';
import { branchScope } from '../core/scope';
import { sendCsv } from '../core/csv';
import { AiClient } from '../ai/ai-client';
import { answerLanguage } from '../ai/lang';
import { checkItems, type Item } from '../ai/manager-facts';
import { BRIEF_SYSTEM, briefFacts, briefPayload, templateBrief } from '../ai/warehouse-brief';
import { HORIZON_DEFAULT, HORIZON_MAX, HORIZON_MIN, reorderRows } from './reorder';
import { reasonText } from './ai.controller';

const KEEPERS = ['storekeeper', 'manager'] as const;
/** CSV/print: at most this many rows (the suggestion of one clinic is far below it). */
export const REORDER_EXPORT_MAX = 1000;

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
const briefBodyZ = z.object({ branch_id: z.string().uuid('Noto‘g‘ri identifikator').optional().nullable(), horizon: z.number().int().optional() });

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
    const list = rows.filter((r) => Number(r.suggested) > 0).slice(0, REORDER_EXPORT_MAX);
    const L = ctx.locale;
    const h = (k: string) => translate(L, `wh.ro.csv.${k}` as MessageKey);
    sendCsv(res, `buyurtma-taklifi-${today}-${horizon}k.csv`,
      [h('item'), h('unit'), h('branch'), h('usable'), h('rate'), h('daysLeft'), h('expiringUnusable'), h('minimum'), h('pack'), h('packs'), h('suggested'), h('price'), h('cost')],
      list.map((r) => [r.name, r.unit, r.branch_name, r.usable, r.daily_rate, r.days_left ?? '', r.expiring_unusable, r.minimum_qty, r.pack_size ?? '', r.packs ?? '', r.suggested,
        (r.purchase_price / 100).toFixed(2), (r.est_cost / 100).toFixed(2)]));
  }

  /** A 3–5 bullet brief of the top items: the model words the server's numbers (live), or the template (off/sample). */
  @Roles(...KEEPERS) @Post('reorder/brief') @HttpCode(200)
  async brief(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(briefBodyZ, body ?? {});
    const horizon = horizonOf(b.horizon);
    const { rows } = await reorderRows(this.db, ctx.tenantId, branchScope(ctx, b.branch_id), horizon);
    const facts = briefFacts(rows, horizon);
    const mode = this.ai.managerMode(ctx.tenantId);
    let bullets: Item[], source: 'model' | 'template' = 'template', dropped = 0, model: string | null = null, reason: string | null = null;
    if (mode !== 'live') {
      bullets = templateBrief(ctx.locale, rows, horizon);
      if (mode === 'off') reason = reasonText(ctx, this.ai.mode() === 'live' ? 'api.ai.freeTier' : this.ai.clinicalOffReason(ctx.tenantId) === 'api.ai.noKey' ? 'api.ai.noKey' : 'api.ai.offMode');
    } else {
      try {
        const { value, model: m } = await this.ai.json({
          route: 'warehouse_brief', system: `${BRIEF_SYSTEM}\n${answerLanguage(ctx.locale)}`, user: JSON.stringify(briefPayload(rows, facts)),
          schema: BRIEF_SCHEMA, validate: briefZ, effort: 'low', maxTokens: 1500, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
        });
        const c = checkItems(value.bullets, facts, 5);
        dropped = c.dropped; model = m;
        if (c.kept.length) { bullets = c.kept; source = 'model'; } else bullets = templateBrief(ctx.locale, rows, horizon);
      } catch (e) {
        bullets = templateBrief(ctx.locale, rows, horizon);
        reason = e instanceof AppError && e.key ? translate(ctx.locale, e.key, e.params) : translate(ctx.locale, 'api.ai.unexpected');
      }
    }
    await audit(this.db.pool, ctx, 'ai.warehouse_brief', 'ai', null, source === 'model' ? `Buyurtma taklifi xulosasi (AI, ${model})` : 'Buyurtma taklifi xulosasi (shablon)');
    return { data: { mode, source, horizon, bullets: bullets.map((x) => ({ text: x.text, fact_keys: x.fact_keys })), dropped, model, reason } };
  }
}
