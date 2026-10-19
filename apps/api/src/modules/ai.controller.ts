import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { aiNoteDraftSchema, aiReportSchema, formatSom, icd10SuggestSchema, newsFeedbackSchema } from '@meduza/contracts';
import { Db } from '../core/db';
import { config } from '../core/config';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, forbidden, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, today } from '../core/clock';
import { branchScope } from '../core/scope';
import { AiClient } from '../ai/ai-client';
import { Icd10Service } from '../ai/icd10';
import { NewsService, SPECIALTIES, specialtyByKey, specialtyOf } from '../ai/news';
import { PatientIdentity, redact } from '../ai/redact';

/** The single demo text that sample mode recognises. Any other text is rejected in sample mode (no fake "AI" answers). */
export const SAMPLE_NOTE_TEXT =
  'Bemor 3 kundan beri tomoq og‘rig‘i va burun bitishidan shikoyat qiladi, kechqurun harorat 37.8 gacha ko‘tarilgan. Oilada bolasi ham shamollagan. ' +
  'Ko‘rikda tomoq shilliq qavati qizargan, bodomsimon bezlar kattalashmagan, o‘pkada vezikulyar nafas, xirillash yo‘q. ' +
  'O‘tkir respirator infeksiya deb hisoblayman. Ko‘p suyuqlik ichish, dam olish, 5 kundan keyin yaxshilanmasa qayta ko‘rikka kelish.';

const SAMPLE_RESULT = {
  complaints: '3 kundan beri tomoq og‘rig‘i va burun bitishi. Kechqurunlari harorat 37.8°C gacha ko‘tarilgan.',
  anamnesis: 'Oilada bolasi ham shamollagan.',
  examination: 'Tomoq shilliq qavati qizargan, bodomsimon bezlar kattalashmagan. O‘pkada vezikulyar nafas, xirillash yo‘q.',
  diagnosis: 'O‘tkir respirator infeksiya (shifokor taxmini).',
  recommendations: 'Ko‘p suyuqlik ichish, dam olish. 5 kundan keyin yaxshilanmasa qayta ko‘rikka kelish.',
};

const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    complaints: { type: 'string' }, anamnesis: { type: 'string' }, examination: { type: 'string' },
    diagnosis: { type: 'string' }, recommendations: { type: 'string' },
  },
  required: ['complaints', 'anamnesis', 'examination', 'diagnosis', 'recommendations'],
  additionalProperties: false,
};

const NOTE_SYSTEM = `Sen klinika shifokoriga yordam beradigan hujjat tartiblovchisan. Shifokor yozgan erkin matnni o‘zbek (lotin) tilida 5 bo‘limga ajrat:
complaints (shikoyatlar), anamnesis (anamnez), examination (ko‘rik), diagnosis (tashxis/xulosa), recommendations (tavsiyalar).
Qoidalar: faqat matnda bor ma’lumotni qayta tartibla va imloni tuzat. Yangi tashxis, dori, doza, tekshiruv yoki matnda yo‘q klinik fakt qo‘shma.
Matnda biror bo‘limga tegishli ma’lumot bo‘lmasa, o‘sha bo‘limga aynan "Kiritilmagan" deb yoz. Bemorning ismi yoki telefonini yozma.`;

const normalize = (s: string) => s.toLowerCase().replace(/[‘’ʻʼ'`]/g, '').replace(/\s+/g, ' ').trim();
const noteZ = z.object({ complaints: z.string(), anamnesis: z.string(), examination: z.string(), diagnosis: z.string(), recommendations: z.string() });
let lastNewsRefresh = 0;

@Controller()
export class AiController {
  constructor(private db: Db, private ai: AiClient, private icd: Icd10Service, private news: NewsService) {}

  /** The patient of an encounter the doctor is treating (for de-identification). Anything else → 404/403. */
  private async patientOf(ctx: Ctx, encounterId?: string): Promise<PatientIdentity | null> {
    if (!encounterId) return null;
    const e = await this.db.one(
      `SELECT e.doctor_id, p.last_name, p.first_name, p.middle_name, p.birth_date, p.patient_number, p.phone
         FROM encounters e JOIN patients p ON p.id = e.patient_id WHERE e.id = $1 AND e.tenant_id = $2`, [encounterId, ctx.tenantId]);
    if (!e) throw notFound('Qabul yozuvi');
    if (e.doctor_id !== ctx.doctorId) throw forbidden('Klinik yozuvni faqat davolovchi shifokor ko‘radi');
    return e;
  }

  @Get('ai/status')
  status() {
    const m = this.ai.mode();
    return { data: { mode: m, model: m === 'live' ? config.ai.model : null, sample_text: m === 'sample' ? SAMPLE_NOTE_TEXT : null,
      reason: m === 'off' ? (config.ai.mode === 'live' ? 'AI kaliti sozlanmagan' : 'AI o‘chirilgan (AI_MODE=off)') : null } };
  }

  /** AI-01: draft restructuring of the doctor's own text. De-identified before sending; never saves or signs. */
  @Roles('doctor') @Post('ai/note-draft') @HttpCode(200)
  async noteDraft(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { text, encounter_id } = parse(aiNoteDraftSchema, body);
    const m = this.ai.mode();
    if (m === 'off') throw new AppError(503, 'AI_OFF', 'AI yordamchisi hozir o‘chirilgan. Qaydni qo‘lda davom ettiring.');
    if (m === 'sample') {
      if (normalize(text) !== normalize(SAMPLE_NOTE_TEXT))
        throw new AppError(422, 'AI_SAMPLE_ONLY', 'Namunaviy rejimda faqat tayyor demo matni tartiblanadi. Haqiqiy AI ulanmagan — qaydni qo‘lda to‘ldiring.');
      await audit(this.db.pool, ctx, 'ai.note_draft', 'ai', null, 'Namunaviy AI natijasi ko‘rsatildi');
      return { data: { mode: 'sample', draft: SAMPLE_RESULT } };
    }
    const patient = await this.patientOf(ctx, encounter_id);
    const { value, model } = await this.ai.json({
      route: 'note_draft', system: NOTE_SYSTEM, user: redact(text, patient), schema: NOTE_SCHEMA, validate: noteZ,
      effort: 'low', maxTokens: 4000, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
    });
    await audit(this.db.pool, ctx, 'ai.note_draft', 'ai', null, `AI loyihasi yaratildi (${model})`);
    return { data: { mode: 'live', draft: value } };
  }

  // ---------- ICD-10 (MKB-10) ----------

  @Roles('doctor') @Get('icd10')
  async icdSearch(@Query('q') q?: string) {
    return { data: await this.icd.search(String(q ?? '').slice(0, 100)) };
  }

  /** Suggested codes for the diagnosis text: AI over the code table when live, word matching otherwise. */
  @Roles('doctor') @Post('ai/icd10-suggest') @HttpCode(200)
  async icdSuggest(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { text, encounter_id } = parse(icd10SuggestSchema, body);
    const patient = await this.patientOf(ctx, encounter_id);
    return { data: await this.icd.suggest(text, ctx, patient) };
  }

  // ---------- AI usage (manager) ----------

  @Roles('manager') @Get('ai/usage')
  async usage(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.rows(
      `SELECT route, count(*)::int AS calls, count(*) FILTER (WHERE outcome = 'ok')::int AS ok,
              count(*) FILTER (WHERE outcome <> 'ok')::int AS failed,
              coalesce(sum(input_tokens),0)::int AS input_tokens, coalesce(sum(output_tokens),0)::int AS output_tokens,
              coalesce(sum(cache_read_tokens),0)::int AS cache_read_tokens, coalesce(sum(cost_usd),0)::float AS cost_usd,
              round(avg(latency_ms))::int AS avg_latency_ms
         FROM ai_usage WHERE (tenant_id = $1 OR tenant_id IS NULL) AND created_at >= demo_now() - interval '30 days'
        GROUP BY route ORDER BY route`, [ctx.tenantId]);
    const today = (await this.db.one(
      `SELECT count(*)::int AS calls, coalesce(sum(cost_usd),0)::float AS cost_usd FROM ai_usage
        WHERE tenant_id = $1 AND created_at >= date_trunc('day', demo_now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'`, [ctx.tenantId]))!;
    const icd = (await this.db.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE source = 'official')::int AS official FROM icd10_codes`))!;
    return { data: { mode: this.ai.mode(), model: config.ai.model, key_configured: !!config.ai.apiKey, by_route: rows, today, icd10: icd } };
  }

  // ---------- Daily specialty news ----------

  /** Latest articles for the doctor's specialty (managers may pick one). */
  @Roles('doctor', 'manager') @Get('news')
  async newsList(@CurrentCtx() ctx: Ctx, @Query('specialty') specialty?: string) {
    const sp = ctx.role === 'doctor' && !specialty ? specialtyOf(ctx.doctorSpecialty) : specialtyByKey(specialty);
    const items = await this.db.rows(
      `SELECT n.id, n.title, n.title_uz, n.summary_uz, n.takeaway_uz, n.journal, n.published, n.url, n.fetched_on, n.model, f.useful
         FROM news_items n LEFT JOIN news_feedback f ON f.item_id = n.id AND f.membership_id = $2
        WHERE n.specialty_key = $1 ORDER BY n.fetched_on DESC, n.created_at DESC LIMIT 10`, [sp.key, ctx.membershipId]);
    return { data: items, meta: { specialty: sp.key, label: sp.label, specialties: SPECIALTIES.map((s) => ({ key: s.key, label: s.label })), news_enabled: config.news.enabled, ai_mode: this.ai.mode() } };
  }

  @Roles('doctor') @Post('news/:id/feedback') @HttpCode(200)
  async newsFeedback(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('Maqola');
    const { useful } = parse(newsFeedbackSchema, body);
    const r = await this.db.rows(
      `INSERT INTO news_feedback (item_id, membership_id, useful) SELECT id, $2, $3 FROM news_items WHERE id = $1
       ON CONFLICT (item_id, membership_id) DO UPDATE SET useful = EXCLUDED.useful, created_at = now() RETURNING item_id`, [id, ctx.membershipId, useful]);
    if (!r.length) throw notFound('Maqola');
    return { data: { ok: true } };
  }

  /** Fetch today's articles now (the background job does this daily). At most once per 10 minutes. */
  @Roles('manager') @Post('news/refresh') @HttpCode(200)
  async newsRefresh(@CurrentCtx() ctx: Ctx) {
    if (!config.news.enabled) throw new AppError(409, 'NEWS_OFF', 'Yangiliklar o‘chirilgan (NEWS_ENABLED=off).');
    if (Date.now() - lastNewsRefresh < 10 * 60_000) throw new AppError(429, 'TOO_SOON', 'Yangiliklar yaqinda yangilandi. 10 daqiqadan keyin urinib ko‘ring.');
    lastNewsRefresh = Date.now();
    return { data: await this.news.refreshAll(ctx.tenantId) };
  }

  /** AI-02: the numbers always come from backend queries; the text only explains them. */
  @Roles('manager') @Post('ai/report-explanation') @HttpCode(200)
  async report(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { question, branch_id } = parse(aiReportSchema, body);
    const branches = branchScope(ctx, branch_id);
    const t = today();
    let facts: Record<string, unknown>; let text: string; let link: string;
    if (question === 'revenue_today') {
      const r = (await this.db.one(`SELECT (coalesce(sum(amount),0) - coalesce((SELECT sum(amount) FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4),0))::bigint AS s,
              count(*)::int AS n FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4`,
        [ctx.tenantId, branches, dayStart(t), dayStart(addDays(t, 1))]))!;
      facts = { date: t, revenue: Number(r.s), payments: r.n };
      text = r.n ? `${t} kuni ${r.n} ta to‘lov qayd etilgan, jami ${formatSom(Number(r.s))}.` : `${t} kuni hali to‘lov qayd etilmagan.`;
      link = `/finance?from=${t}&to=${t}`;
    } else if (question === 'top_services') {
      const rows = await this.db.rows(`SELECT o.service_name, sum(it.line_total)::bigint AS v FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
        WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.performed_at >= $3 AND o.performed_at < $4 AND o.status IN ('completed','verified') AND i.status <> 'void'
        GROUP BY 1 ORDER BY v DESC LIMIT 3`, [ctx.tenantId, branches, dayStart(addDays(t, -29)), dayStart(addDays(t, 1))]);
      facts = { from: addDays(t, -29), to: t, top: rows.map((r) => ({ service: r.service_name, value: Number(r.v) })) };
      text = rows.length ? `Oxirgi 30 kunda eng ko‘p summa bergan xizmatlar: ${rows.map((r, i) => `${i + 1}) ${r.service_name} — ${formatSom(Number(r.v))}`).join('; ')}.` : 'Oxirgi 30 kunda bajarilgan xizmat yo‘q.';
      link = `/reports?period=30d`;
    } else {
      const r = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(total - paid_amount),0)::bigint AS s FROM invoices WHERE tenant_id = $1 AND branch_id = ANY($2) AND status IN ('unpaid','partially_paid') AND total > paid_amount`, [ctx.tenantId, branches]))!;
      facts = { invoices: r.n, debt: Number(r.s) };
      text = r.n ? `Hozir ${r.n} ta hisob bo‘yicha qarzdorlik bor, jami ${formatSom(Number(r.s))}.` : 'Qarzdor hisob yo‘q.';
      link = `/cashier?debt=1`;
    }
    // In every mode the numbers above are computed by SQL; the sentence is a template, not a model output.
    return { data: { mode: 'template', text, facts, link, branch_ids: branches } };
  }
}
