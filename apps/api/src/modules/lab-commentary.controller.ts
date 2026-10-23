// «Natija sharhi» (docs/AI.md): commentary on a VERIFIED lab result, for doctors only. Clinical route
// (`lab_commentary` is not in PUBLIC_ROUTES): the production switch, the Gemini free-tier rule and the daily budget
// apply. The model gets server-computed facts (values, ranges, flags, previous values and changes) plus sex and an
// age band — never a name or free text. Nothing is stored except one ai_usage row (tokens, no text) and an audit line.
import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { translate } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, forbidden, notFound } from '../core/errors';
import { isUuid } from '../core/validate';
import { audit } from '../core/audit';
import { AiClient } from '../ai/ai-client';
import { answerLanguage } from '../ai/lang';
import { buildLabFacts, checkSentences, criticalLines, promptPayload, templateCommentary, type LabFacts, type Sentence } from '../ai/lab-facts';
import { reasonText } from './ai.controller';

const sentenceZ = z.object({ text: z.string().max(400), fact_keys: z.array(z.string().max(64)).max(12) });
const outZ = z.object({ sentences: z.array(sentenceZ).max(8) });
const OUT_SCHEMA = {
  type: 'object',
  properties: { sentences: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, fact_keys: { type: 'array', items: { type: 'string' } } }, required: ['text', 'fact_keys'], additionalProperties: false } } },
  required: ['sentences'], additionalProperties: false,
};
export const LAB_SYSTEM = `Sen shifokorga tasdiqlangan laboratoriya natijasi bo‘yicha qisqa sharh yozasan. Senga faqat server hisoblagan faktlar beriladi (JSON): har bir ko‘rsatkichning qiymati, birligi, me’yor chegarasi (ref_low/ref_high), flag (low/high/normal), critical, shu bemorning oldingi tasdiqlangan qiymatlari (days_before — necha kun oldin) va o‘zgarish (change — farq, change_pct — foiz).
2–5 ta qisqa gap yoz: qaysi ko‘rsatkichlar me’yordan tashqarida, oldingi tahlilga nisbatan qanday o‘zgargan, qaysilari kritik.
Qat’iy qoidalar: tashxis qo‘yma va taxmin qilma (kasallik nomini yozma); dori, doza, davolash yoki tekshiruv tavsiya qilma; faqat faktlarni so‘zga aylantir.
Raqamlar: faqat faktlardagi qiymatlarni o‘zgartirmasdan yoz, o‘zing hisoblama; sana, yosh yoki faktda yo‘q boshqa raqam yozma. Har bir gapda ishlatgan faktlaring kalitlarini fact_keys ga aynan yoz (masalan "HGB.value", "HGB.prev1", "HGB.change_pct").`;

/** Verified results never change, so a live commentary is kept in memory per order and language (doctors only). */
const CACHE = new Map<string, any>();
const CACHE_MAX = 500;

@Controller('orders')
export class LabCommentaryController {
  constructor(private db: Db, private ai: AiClient) {}

  /**
   * The order if this doctor may see its result — the same rule as the patient card, which shows a doctor the verified
   * values of their patient in any branch: same tenant (else 404), a patient of theirs (else 403), verified (else 409).
   */
  private async order(ctx: Ctx, id: string) {
    if (!isUuid(id)) throw notFound('Buyurtma');
    const o = await this.db.one(
      `SELECT o.id, o.tenant_id, o.branch_id, o.patient_id, o.service_name, o.status, p.sex, p.birth_date, lr.values, lr.status AS result_status, lr.verified_at, s.lab_template
         FROM service_orders o JOIN patients p ON p.id = o.patient_id JOIN services s ON s.id = o.service_id LEFT JOIN lab_results lr ON lr.order_id = o.id
        WHERE o.id = $1 AND o.tenant_id = $2 AND o.category = 'lab'`, [id, ctx.tenantId]);
    if (!o) throw notFound('Buyurtma');
    const mine = await this.db.one(`SELECT 1 FROM appointments WHERE tenant_id = $1 AND patient_id = $2 AND doctor_id = $3 LIMIT 1`, [ctx.tenantId, o.patient_id, ctx.doctorId]);
    if (!mine) throw forbidden('Bu bemor sizga biriktirilmagan');
    if (o.status !== 'verified' || o.result_status !== 'verified') throw conflict('NOT_VERIFIED', 'Sharh faqat tasdiqlangan natija uchun');
    return o;
  }

  private async modelCommentary(ctx: Ctx, f: LabFacts) {
    const { value, model } = await this.ai.json({
      route: 'lab_commentary', system: `${LAB_SYSTEM}\n${answerLanguage(ctx.locale)}`, user: JSON.stringify(promptPayload(f)),
      schema: OUT_SCHEMA, validate: outZ, effort: 'low', maxTokens: 1500, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
    });
    const { kept, dropped } = checkSentences(value.sentences, f, 5);
    return { kept, dropped, model };
  }

  @Roles('doctor') @Post(':id/commentary') @HttpCode(200)
  async commentary(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const o = await this.order(ctx, id);
    const key = `${ctx.tenantId}:${o.id}:${ctx.locale}`;
    const mode = this.ai.clinicalMode(ctx.tenantId);
    if (mode === 'live' && CACHE.has(key)) return { data: { ...CACHE.get(key), cached: true } };
    const f = await buildLabFacts(this.db, o);
    const base = {
      order_id: o.id, mode, critical: criticalLines(ctx.locale, f),
      params: f.params.map((p) => ({ code: p.code, name: p.name, unit: p.unit, value: p.text, flag: p.flag, critical: p.critical, previous: p.previous.map((x) => ({ date: x.date, value: x.text })), change: p.change, change_pct: p.change_pct })),
    };
    let sentences: Sentence[], source: 'model' | 'template' = 'template', dropped = 0, model: string | null = null, reason: string | null = null;
    if (mode !== 'live') {
      sentences = templateCommentary(ctx.locale, f);
      reason = mode === 'sample' ? null : reasonText(ctx, this.ai.clinicalOffReason(ctx.tenantId));
    } else {
      try {
        const r = await this.modelCommentary(ctx, f);
        dropped = r.dropped; model = r.model;
        if (r.kept.length) { sentences = r.kept; source = 'model'; } else sentences = templateCommentary(ctx.locale, f);
      } catch (e) {
        sentences = templateCommentary(ctx.locale, f);
        reason = e instanceof AppError && e.key ? translate(ctx.locale, e.key, e.params) : translate(ctx.locale, 'api.ai.unexpected');
      }
    }
    const out = { ...base, source, sentences: sentences.map((s) => ({ text: s.text })), dropped, model, reason };
    await audit(this.db.pool, ctx, 'ai.lab_commentary', 'order', o.id, source === 'model' ? `Natija sharhi (AI, ${model})` : 'Natija sharhi (shablon)', o.branch_id);
    if (source === 'model') {
      if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
      CACHE.set(key, out);
    }
    return { data: { ...out, cached: false } };
  }
}

/** Tests reset the in-memory cache between scenarios. */
export const clearLabCommentaryCache = () => CACHE.clear();
