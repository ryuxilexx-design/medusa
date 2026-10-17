import { Body, Controller, Get, HttpCode, Logger, Post } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { aiNoteDraftSchema, aiReportSchema, formatSom } from '@meduza/contracts';
import { Db } from '../core/db';
import { config } from '../core/config';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError } from '../core/errors';
import { parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, today } from '../core/clock';
import { branchScope } from '../core/scope';

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

@Controller('ai')
export class AiController {
  private log = new Logger('AI');
  private client = config.ai.mode === 'live' && config.ai.apiKey ? new Anthropic({ apiKey: config.ai.apiKey, timeout: config.ai.timeoutMs, maxRetries: 1 }) : null;
  constructor(private db: Db) {}

  private get mode(): 'off' | 'sample' | 'live' { return config.ai.mode === 'live' && !this.client ? 'off' : config.ai.mode; }

  @Get('status')
  status() {
    const m = this.mode;
    return { data: { mode: m, sample_text: m === 'sample' ? SAMPLE_NOTE_TEXT : null,
      reason: m === 'off' ? (config.ai.mode === 'live' ? 'AI kaliti sozlanmagan' : 'AI o‘chirilgan (AI_MODE=off)') : null } };
  }

  /** AI-01: draft restructuring of the doctor's own text. Never saves or signs anything; the doctor applies it to the draft. */
  @Roles('doctor') @Post('note-draft') @HttpCode(200)
  async noteDraft(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { text } = parse(aiNoteDraftSchema, body);
    const m = this.mode;
    if (m === 'off') throw new AppError(503, 'AI_OFF', 'AI yordamchisi hozir o‘chirilgan. Qaydni qo‘lda davom ettiring.');
    if (m === 'sample') {
      if (normalize(text) !== normalize(SAMPLE_NOTE_TEXT))
        throw new AppError(422, 'AI_SAMPLE_ONLY', 'Namunaviy rejimda faqat tayyor demo matni tartiblanadi. Haqiqiy AI ulanmagan — qaydni qo‘lda to‘ldiring.');
      await audit(this.db.pool, ctx, 'ai.note_draft', 'ai', null, 'Namunaviy AI natijasi ko‘rsatildi');
      return { data: { mode: 'sample', draft: SAMPLE_RESULT } };
    }
    try {
      const response = await this.client!.beta.messages.create({
        model: config.ai.model,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: NOTE_SCHEMA } },
        system: NOTE_SYSTEM,
        messages: [{ role: 'user', content: text }],
      } as any);
      if (response.stop_reason === 'refusal') throw new AppError(502, 'AI_REFUSED', 'AI bu matnni qayta ishlamadi. Qaydni qo‘lda davom ettiring.');
      const block = response.content.find((b: any) => b.type === 'text') as any;
      const draft = JSON.parse(block?.text ?? '{}');
      for (const k of Object.keys(SAMPLE_RESULT)) if (typeof draft[k] !== 'string') draft[k] = 'Kiritilmagan';
      await audit(this.db.pool, ctx, 'ai.note_draft', 'ai', null, `AI loyihasi yaratildi (${config.ai.model})`);
      return { data: { mode: 'live', draft } };
    } catch (e) {
      if (e instanceof AppError) throw e;
      const timeout = e instanceof Anthropic.APIConnectionTimeoutError;
      this.log.warn(`AI xatosi: ${(e as Error).name}`);
      throw new AppError(timeout ? 504 : 502, timeout ? 'AI_TIMEOUT' : 'AI_ERROR',
        timeout ? 'AI javob bermadi (vaqt tugadi). Qoralama saqlangan, qo‘lda davom ettiring.' : 'AI xizmatida xato. Qoralama saqlangan, qo‘lda davom ettiring.');
    }
  }

  /** AI-02: the numbers always come from backend queries; the text only explains them. */
  @Roles('manager') @Post('report-explanation') @HttpCode(200)
  async report(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { question, branch_id } = parse(aiReportSchema, body);
    const branches = branchScope(ctx, branch_id);
    const t = today();
    let facts: Record<string, unknown>; let text: string; let link: string;
    if (question === 'revenue_today') {
      const r = (await this.db.one(`SELECT coalesce(sum(amount),0)::bigint AS s, count(*)::int AS n FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4`,
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
