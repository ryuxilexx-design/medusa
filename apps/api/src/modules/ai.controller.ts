import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { aiNoteDraftSchema, aiReportSchema, formatSom, icd10SuggestSchema, type MessageKey, newsFeedbackSchema, NEWS_TOPICS_MAX, newsSaveSchema, newsTopicsSchema, translate } from '@meduza/contracts';
import { Db } from '../core/db';
import { config } from '../core/config';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, forbidden, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, today } from '../core/clock';
import { branchScope } from '../core/scope';
import { AiClient } from '../ai/ai-client';
import { answerLanguage } from '../ai/lang';
import { Icd10Service } from '../ai/icd10';
import { NewsService, SPECIALTIES, specialtyByKey, specialtyOf } from '../ai/news';
import { PatientIdentity, redact } from '../ai/redact';
import { NET_LINE } from './billing';

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

/** The «why AI is off» line in the person's language (the client takes it from the catalog key). */
export const reasonText = (ctx: Ctx, key: MessageKey | null) => (key ? translate(ctx.locale, key) : null);
const normalize = (s: string) => s.toLowerCase().replace(/[‘’ʻʼ'`]/g, '').replace(/\s+/g, ' ').trim();
const noteZ = z.object({ complaints: z.string(), anamnesis: z.string(), examination: z.string(), diagnosis: z.string(), recommendations: z.string() });
let lastNewsRefresh = 0;

/** The patient of an encounter the doctor is treating (for de-identification). Anything else → 404/403. */
export async function patientOf(db: Db, ctx: Ctx, encounterId?: string): Promise<PatientIdentity | null> {
  if (!encounterId) return null;
  const e = await db.one(
    `SELECT e.doctor_id, p.last_name, p.first_name, p.middle_name, p.birth_date, p.patient_number, p.phone
       FROM encounters e JOIN patients p ON p.id = e.patient_id WHERE e.id = $1 AND e.tenant_id = $2`, [encounterId, ctx.tenantId]);
  if (!e) throw notFound('Qabul yozuvi');
  if (e.doctor_id !== ctx.doctorId) throw forbidden('Klinik yozuvni faqat davolovchi shifokor ko‘radi');
  return e;
}

/**
 * The note draft (AI-01) for a text: every AI guard applies (clinical mode, sample-only text, production switch,
 * free tier, budget), the text is de-identified before it leaves the server, nothing is saved. Also used by dictation.
 */
export async function draftNote(db: Db, ai: AiClient, ctx: Ctx, text: string, encounterId?: string) {
  const m = ai.clinicalMode(ctx.tenantId);
  if (m === 'off') throw ai.mode() === 'live' ? ai.clinicalError(ctx.tenantId) : coded(503, 'AI_OFF', 'api.ai.assistantOff');
  if (m === 'sample') {
    if (normalize(text) !== normalize(SAMPLE_NOTE_TEXT)) throw coded(422, 'AI_SAMPLE_ONLY', 'api.ai.sampleOnly');
    await audit(db.pool, ctx, 'ai.note_draft', 'ai', null, 'Namunaviy AI natijasi ko‘rsatildi');
    return { mode: 'sample' as const, draft: SAMPLE_RESULT };
  }
  const patient = await patientOf(db, ctx, encounterId);
  const { value, model } = await ai.json({
    route: 'note_draft', system: `${NOTE_SYSTEM}\n${answerLanguage(ctx.locale)} Bo‘sh bo‘lim uchun baribir aynan "Kiritilmagan" deb yoz.`, user: redact(text, patient), schema: NOTE_SCHEMA, validate: noteZ,
    effort: 'low', maxTokens: 4000, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
  });
  await audit(db.pool, ctx, 'ai.note_draft', 'ai', null, `AI loyihasi yaratildi (${model})`);
  return { mode: 'live' as const, draft: value as z.infer<typeof noteZ> };
}

@Controller()
export class AiController {
  constructor(private db: Db, private ai: AiClient, private icd: Icd10Service, private news: NewsService) {}

  private patientOf(ctx: Ctx, encounterId?: string) { return patientOf(this.db, ctx, encounterId); }

  @Get('ai/status')
  status(@CurrentCtx() ctx: Ctx) {
    // the doctor's AI buttons follow the clinical mode: a provider that may not receive this clinic's text counts as off
    const m = this.ai.clinicalMode(ctx.tenantId);
    // the sample clinical note is for the doctor's AI button only — no other role ever receives clinical-looking text
    return { data: { mode: m, provider: m === 'live' ? config.ai.provider : null, model: m === 'live' ? config.ai.model : null, sample_text: m === 'sample' && ctx.role === 'doctor' ? SAMPLE_NOTE_TEXT : null,
      reason: reasonText(ctx, this.ai.clinicalOffReason(ctx.tenantId)) } };
  }

  /** AI-01: draft restructuring of the doctor's own text. De-identified before sending; never saves or signs. */
  @Roles('doctor') @Post('ai/note-draft') @HttpCode(200)
  async noteDraft(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { text, encounter_id } = parse(aiNoteDraftSchema, body);
    return { data: await draftNote(this.db, this.ai, ctx, text, encounter_id) };
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
    return { data: { mode: this.ai.mode(), provider: config.ai.provider, model: config.ai.model, key_configured: !!config.ai.apiKey,
      gemini_free: config.ai.provider === 'gemini' && !config.ai.geminiPaid, clinical_allowed: this.ai.clinicalAllowed(ctx.tenantId), by_route: rows, today, icd10: icd } };
  }

  // ---------- Daily specialty news ----------

  /** The doctor's own specialty and the extra topics they follow. */
  private async newsKeys(ctx: Ctx) {
    const own = specialtyOf(ctx.doctorSpecialty).key;
    const followed = (await this.db.rows(`SELECT specialty_key FROM news_topics WHERE membership_id = $1 AND tenant_id = $2 ORDER BY created_at`, [ctx.membershipId, ctx.tenantId]))
      .map((r) => r.specialty_key).filter((k) => k !== own && SPECIALTIES.some((x) => x.key === k));
    return { own, followed };
  }

  /**
   * Doctor: a personal feed — own specialty + followed topics (or one topic), or the saved articles; newest first,
   * one row per article even when it belongs to several topics. Manager: one specialty to preview (settings).
   */
  @Roles('doctor', 'manager') @Get('news')
  async newsList(@CurrentCtx() ctx: Ctx, @Query('specialty') specialty?: string, @Query('view') view?: string) {
    const all = SPECIALTIES.map((s) => ({ key: s.key, label: s.label }));
    const base = { specialties: all, news_enabled: config.news.enabled, ai_mode: this.ai.mode() };
    if (ctx.role !== 'doctor') {
      const sp = specialtyByKey(specialty);
      const items = await this.db.rows(
        `SELECT n.id, n.specialty_key, n.title, n.title_uz, n.summary_uz, n.takeaway_uz, n.journal, n.published, n.url, n.fetched_on, n.model, NULL::boolean AS useful
           FROM news_items n WHERE n.specialty_key = $1 ORDER BY n.fetched_on DESC, n.created_at DESC LIMIT 10`, [sp.key]);
      return { data: items, meta: { ...base, specialty: sp.key, label: sp.label } };
    }
    const { own, followed } = await this.newsKeys(ctx);
    const keys = specialty && SPECIALTIES.some((x) => x.key === specialty) ? [specialty] : [own, ...followed];
    const saved = view === 'saved';
    const items = await this.db.rows(
      `SELECT * FROM (
         SELECT DISTINCT ON (n.external_id) n.id, n.specialty_key, n.title, n.title_uz, n.summary_uz, n.takeaway_uz, n.journal, n.published, n.url,
                n.fetched_on, n.model, n.created_at, f.useful, r.read_at, r.saved_at
           FROM news_items n
           LEFT JOIN news_feedback f ON f.item_id = n.id AND f.membership_id = $2
           LEFT JOIN news_reads r ON r.item_id = n.id AND r.membership_id = $2
          WHERE ${saved ? 'r.saved_at IS NOT NULL AND $1::text[] IS NOT NULL' : 'n.specialty_key = ANY($1::text[])'}
          ORDER BY n.external_id, (n.specialty_key = $3) DESC, n.fetched_on DESC) x
        ORDER BY ${saved ? 'x.saved_at DESC' : 'x.fetched_on DESC, x.created_at DESC'} LIMIT 40`, [keys, ctx.membershipId, own]);
    const unread = items.filter((i) => !i.read_at).length;
    return { data: items, meta: { ...base, specialty: own, label: specialtyByKey(own).label, own, followed, unread } };
  }

  @Roles('doctor') @Get('news/topics')
  async newsTopics(@CurrentCtx() ctx: Ctx) {
    const { own, followed } = await this.newsKeys(ctx);
    return { data: { own, followed, all: SPECIALTIES.map((s) => ({ key: s.key, label: s.label })), max: NEWS_TOPICS_MAX } };
  }

  /** Replaces the followed topics (own specialty is always included and not stored). */
  @Roles('doctor') @Put('news/topics')
  async setNewsTopics(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { keys } = parse(newsTopicsSchema, body);
    const own = specialtyOf(ctx.doctorSpecialty).key;
    const clean = [...new Set(keys)].filter((k) => k !== own);
    if (clean.some((k) => !SPECIALTIES.some((x) => x.key === k))) throw new AppError(422, 'VALIDATION', 'Maydonlarni tekshiring', { keys: 'Noma’lum mavzu' });
    await this.db.tx(async (c) => {
      await c.query(`DELETE FROM news_topics WHERE membership_id = $1 AND tenant_id = $2`, [ctx.membershipId, ctx.tenantId]);
      for (const k of clean) await c.query(`INSERT INTO news_topics (membership_id, tenant_id, specialty_key) VALUES ($1,$2,$3)`, [ctx.membershipId, ctx.tenantId, k]);
    });
    // a newly followed topic gets today's articles in the background (the hourly job would also do it)
    if (config.news.enabled) void Promise.all(clean.map((k) => this.news.refreshSpecialty(k).catch(() => 0)));
    return { data: { own, followed: clean } };
  }

  @Roles('doctor') @Post('news/:id/read') @HttpCode(200)
  async newsRead(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Maqola');
    const r = await this.db.rows(
      `INSERT INTO news_reads (item_id, membership_id, read_at) SELECT id, $2, now() FROM news_items WHERE id = $1
       ON CONFLICT (item_id, membership_id) DO UPDATE SET read_at = coalesce(news_reads.read_at, now()) RETURNING item_id`, [id, ctx.membershipId]);
    if (!r.length) throw notFound('Maqola');
    return { data: { ok: true } };
  }

  @Roles('doctor') @Post('news/:id/save') @HttpCode(200)
  async newsSave(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('Maqola');
    const { saved } = parse(newsSaveSchema, body);
    const r = await this.db.rows(
      `INSERT INTO news_reads (item_id, membership_id, read_at, saved_at) SELECT id, $2, now(), CASE WHEN $3 THEN now() END FROM news_items WHERE id = $1
       ON CONFLICT (item_id, membership_id) DO UPDATE SET saved_at = CASE WHEN $3 THEN coalesce(news_reads.saved_at, now()) END,
         read_at = coalesce(news_reads.read_at, now()) RETURNING item_id`, [id, ctx.membershipId, saved]);
    if (!r.length) throw notFound('Maqola');
    return { data: { ok: true, saved } };
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
    // the sentence in the manager's language; numbers and service names are data, kept as they are
    const L = ctx.locale;
    const som = (v: number) => formatSom(v, true, L);
    let facts: Record<string, unknown>; let text: string; let link: string;
    if (question === 'revenue_today') {
      const P = [ctx.tenantId, branches, dayStart(t), dayStart(addDays(t, 1))];
      const p = (await this.db.one(`SELECT coalesce(sum(amount),0)::bigint AS s, count(*)::int AS n FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4`, P))!;
      const r = (await this.db.one(`SELECT coalesce(sum(amount),0)::bigint AS s, count(*)::int AS n FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4`, P))!;
      const net = Number(p.s) - Number(r.s);
      facts = { date: t, payments_total: Number(p.s), payments: p.n, refunds_total: Number(r.s), refunds: r.n, revenue: net };
      text = (p.n ? translate(L, 'api.report.payments', { date: t, n: p.n, sum: som(Number(p.s)) }) : translate(L, 'api.report.noPayments', { date: t }))
        + (r.n ? ' ' + translate(L, 'api.report.refunds', { n: r.n, sum: som(Number(r.s)), net: som(net) }) : '');
      link = `/finance?from=${t}&to=${t}`;
    } else if (question === 'top_services') {
      const rows = await this.db.rows(`SELECT o.service_name, sum(${NET_LINE})::bigint AS v FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
        WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.performed_at >= $3 AND o.performed_at < $4 AND o.status IN ('completed','verified') AND i.status <> 'void'
        GROUP BY 1 ORDER BY v DESC LIMIT 3`, [ctx.tenantId, branches, dayStart(addDays(t, -29)), dayStart(addDays(t, 1))]);
      facts = { from: addDays(t, -29), to: t, top: rows.map((r) => ({ service: r.service_name, value: Number(r.v) })) };
      text = rows.length ? translate(L, 'api.report.topServices', { list: rows.map((r, i) => `${i + 1}) ${r.service_name} — ${som(Number(r.v))}`).join('; ') }) : translate(L, 'api.report.noServices');
      link = `/reports?period=30d`;
    } else {
      const r = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(total - paid_amount),0)::bigint AS s FROM invoices WHERE tenant_id = $1 AND branch_id = ANY($2) AND status IN ('unpaid','partially_paid') AND total > paid_amount`, [ctx.tenantId, branches]))!;
      facts = { invoices: r.n, debt: Number(r.s) };
      text = r.n ? translate(L, 'api.report.debt', { n: r.n, sum: som(Number(r.s)) }) : translate(L, 'api.report.noDebt');
      link = `/cashier?debt=1`;
    }
    // In every mode the numbers above are computed by SQL; the sentence is a template, not a model output.
    return { data: { mode: 'template', text, facts, link, branch_ids: branches } };
  }
}
