// The manager's AI (docs/AI.md): a daily digest and «ask the numbers». Non-clinical by construction — the model sees
// only SQL-computed numbers and names of doctors/services/items; every number it writes is checked against the
// facts it cites. ai_usage keeps tokens and cost only; the audit keeps the template id, never the question.
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { formatSom, translate, type MessageKey } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, invalid } from '../core/errors';
import { isDate, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, now, today } from '../core/clock';
import { branchScope } from '../core/scope';
import { AiClient } from '../ai/ai-client';
import { answerLanguage } from '../ai/lang';
import { redact } from '../ai/redact';
import { buildFacts, checkItems, templateDigest, type Alert, type Digest, type Facts, type FactSheet, type Item } from '../ai/manager-facts';
import { checkPlan, PLAN_SCHEMA, planZ, rowFacts, runTemplate, TEMPLATE_HELP, TEMPLATE_IDS, type AskParams, type Result } from '../ai/manager-ask';
import { reasonText } from './ai.controller';

/** Regenerations of the digest per clinic and Tashkent day. */
export const DIGEST_REGEN_PER_DAY = 5;

const itemZ = z.object({ text: z.string().max(400), fact_keys: z.array(z.string().max(64)).max(12) });
const digestZ = z.object({
  bullets: z.array(itemZ).max(10),
  alerts: z.array(itemZ.extend({ severity: z.enum(['info', 'warning', 'critical']) })).max(6),
});
const ITEM_SCHEMA = { type: 'object', properties: { text: { type: 'string' }, fact_keys: { type: 'array', items: { type: 'string' } } }, required: ['text', 'fact_keys'], additionalProperties: false };
const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    bullets: { type: 'array', items: ITEM_SCHEMA },
    alerts: { type: 'array', items: { ...ITEM_SCHEMA, properties: { ...ITEM_SCHEMA.properties, severity: { type: 'string', enum: ['info', 'warning', 'critical'] } }, required: ['text', 'fact_keys', 'severity'] } },
  },
  required: ['bullets', 'alerts'],
  additionalProperties: false,
};
const answerZ = z.object({ sentences: z.array(itemZ).max(6) });
const ANSWER_SCHEMA = { type: 'object', properties: { sentences: { type: 'array', items: ITEM_SCHEMA } }, required: ['sentences'], additionalProperties: false };

const NUMBER_RULES = `Raqamlar qoidasi: faqat faktlardagi qiymatlarni o‘zgartirmasdan yoz; o‘zing hisob-kitob qilma (qo‘shma, ayirma, foiz hisoblama) — farqlar, foizlar va jamilar faktlarda tayyor.
Pul summasini so‘mda, minglarni bo‘shliq bilan ajratib yoz (masalan 1 250 000 so‘m) yoki "1,3 mln so‘m" ko‘rinishida. Faktda yo‘q hech qanday raqam (sana, yil, tartib raqami) yozma.
Har bir band/gapda o‘zi ishlatgan faktlarning kalitlarini fact_keys ro‘yxatiga aynan yoz.`;
const DIGEST_SYSTEM = `Sen klinika rahbari uchun kunlik qisqa xulosa yozasan. Senga faqat raqamli faktlar beriladi (JSON): period=day — kun, compare — o‘tgan haftaning shu kuni, now — hozirgi holat.
bullets: 3–6 ta "nima bo‘ldi" bandi (eng muhimlari: tushum va uning o‘zgarishi, qabullar, yangi bemorlar, eng ko‘p tushum bergan xizmat, eng band shifokor).
alerts: ko‘pi bilan 3 ta "e’tibor bering" bandi (qarzlar, kam qolgan yoki muddati o‘tayotgan dorilar, kamera xavfsizlik signallari, chek berilmagan to‘lovlar, yetkazilmagan xabarlar, tasdiq kutayotgan talabnomalar); severity: info | warning | critical. Muammo bo‘lmasa alerts bo‘sh.
Har band bitta qisqa gap. Kunni "kecha"/"o‘tgan hafta shu kuni" deb ata. Bemorlar, tashxis yoki davolash haqida hech narsa yozma va taxmin qilma.
${NUMBER_RULES}`;
const ANSWER_SYSTEM = `Sen klinika rahbarining savoliga tayyor jadval natijasi asosida 1–3 qisqa gapda javob berasan. Faktlar: rN.<ustun> — N-qator qiymati (label — qator nomi), total.<ustun> — jami, rows.count — qatorlar soni.
Jadvalda yo‘q narsani taxmin qilma; bemorlar va klinik ma’lumot haqida yozma.
${NUMBER_RULES}`;

const digestQueryZ = z.object({ date: z.string().optional(), branch_id: z.string().optional().nullable() });
const askZ = z.object({
  question: z.string().trim().min(3, 'Savolni yozing').max(300, 'Savol 300 belgidan oshmasin').optional(),
  template: z.string().max(64).optional(),
  params: z.record(z.unknown()).optional(),
  branch_id: z.string().uuid('Noto‘g‘ri identifikator').optional().nullable(),
}).refine((b) => b.question || b.template, { message: 'Savolni yozing', path: ['question'] });

type DigestOut = {
  day: string; compare_day: string; mode: 'live' | 'sample' | 'off'; source: 'model' | 'cache' | 'template'; digest: Digest; facts: Facts;
  generated_at: string; model: string | null; dropped: number; regenerations_left: number; reason: string | null;
};

@Controller()
export class ManagerAiController {
  constructor(private db: Db, private ai: AiClient) {}

  /** Yesterday unless a day is given; never in the future, at most a year back. */
  private digestDay(date?: string) {
    const t = today();
    const day = date || addDays(t, -1);
    if (!isDate(day) || day > t || day < addDays(t, -366)) throw invalid({ date: 'Noto‘g‘ri sana' });
    return day;
  }

  private async regenLeft(tenantId: string) {
    const r = await this.db.one(
      `SELECT count(*)::int AS n FROM ai_digest_runs WHERE tenant_id = $1
          AND created_at >= date_trunc('day', (SELECT demo_now()) AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'`, [tenantId]);
    return Math.max(0, DIGEST_REGEN_PER_DAY - (r?.n ?? 0));
  }

  /** The model's digest from a fact sheet, checked: unknown fact keys or numbers that differ from the facts drop the bullet. */
  private async modelDigest(ctx: Ctx, sheet: FactSheet) {
    const { value, model } = await this.ai.json({
      route: 'manager_digest', system: `${DIGEST_SYSTEM}\n${answerLanguage(ctx.locale)}`, user: JSON.stringify({ facts: sheet.facts }),
      schema: DIGEST_SCHEMA, validate: digestZ, effort: 'low', maxTokens: 2000, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
    });
    const b = checkItems<Item>(value.bullets, sheet.facts, 6);
    const a = checkItems<Alert>(value.alerts, sheet.facts, 3);
    return { digest: { bullets: b.kept, alerts: a.kept }, dropped: b.dropped + a.dropped, model };
  }

  private async digestFor(ctx: Ctx, day: string, branches: string[], regenerate: boolean): Promise<DigestOut> {
    const mode = this.ai.managerMode(ctx.tenantId);
    const scopeKey = [...branches].sort().join(',');
    if (mode !== 'live') {
      if (regenerate) throw coded(503, 'AI_OFF', 'api.ai.off');
      const sheet = await buildFacts(this.db, ctx.tenantId, branches, day);
      return { day, compare_day: sheet.compare_day, mode, source: 'template', digest: templateDigest(ctx.locale, sheet), facts: sheet.facts,
        generated_at: now().toISOString(), model: null, dropped: 0, regenerations_left: 0, reason: reasonText(ctx, this.offReason(ctx)) };
    }
    if (regenerate) {
      // the limit counts attempts (a failed model call costs too); the row is written before the call
      const ok = await this.db.tx(async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('ai_digest_runs:' || $1))`, [ctx.tenantId]);
        const n = (await c.query(`SELECT count(*)::int AS n FROM ai_digest_runs WHERE tenant_id = $1
            AND created_at >= date_trunc('day', (SELECT demo_now()) AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'`, [ctx.tenantId])).rows[0].n;
        if (n >= DIGEST_REGEN_PER_DAY) return false;
        await c.query(`INSERT INTO ai_digest_runs (tenant_id, membership_id) VALUES ($1, $2)`, [ctx.tenantId, ctx.membershipId]);
        return true;
      });
      if (!ok) throw coded(429, 'AI_DIGEST_LIMIT', 'mgrai.err.regenLimit', { n: DIGEST_REGEN_PER_DAY });
    }
    // one model call per clinic/scope/day/language even when two managers open the dashboard at once
    return this.db.tx(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ai_digest:${ctx.tenantId}:${scopeKey}:${day}:${ctx.locale}`]);
      if (!regenerate) {
        const hit = (await c.query(`SELECT * FROM ai_digests WHERE tenant_id = $1 AND scope_key = $2 AND day = $3 AND locale = $4`, [ctx.tenantId, scopeKey, day, ctx.locale])).rows[0];
        if (hit) return { day, compare_day: addDays(day, -7), mode, source: 'cache' as const, digest: hit.digest, facts: hit.facts, generated_at: new Date(hit.generated_at).toISOString(),
          model: hit.model, dropped: hit.dropped, regenerations_left: await this.regenLeft(ctx.tenantId), reason: null };
      }
      const sheet = await buildFacts(this.db, ctx.tenantId, branches, day);
      let out: { digest: Digest; dropped: number; model: string | null };
      try {
        out = await this.modelDigest(ctx, sheet);
      } catch (e) {
        if (regenerate) throw e;
        // opening the dashboard still shows the day: the template digest, not cached, with the reason
        return { day, compare_day: sheet.compare_day, mode, source: 'template' as const, digest: templateDigest(ctx.locale, sheet), facts: sheet.facts,
          generated_at: now().toISOString(), model: null, dropped: 0, regenerations_left: await this.regenLeft(ctx.tenantId),
          reason: e instanceof AppError && e.key ? translate(ctx.locale, e.key, e.params) : translate(ctx.locale, 'api.ai.unexpected') };
      }
      // nothing survived the check: the template bullets stand in (the model's alerts, if any survived, are kept)
      const source = out.digest.bullets.length ? 'model' as const : 'template' as const;
      const digest: Digest = out.digest.bullets.length ? out.digest : { bullets: templateDigest(ctx.locale, sheet).bullets, alerts: out.digest.alerts };
      const row = (await c.query(
        `INSERT INTO ai_digests (tenant_id, scope_key, branch_ids, day, locale, facts, digest, model, dropped, generated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id, scope_key, day, locale) DO UPDATE SET facts = EXCLUDED.facts, digest = EXCLUDED.digest, model = EXCLUDED.model,
           dropped = EXCLUDED.dropped, generated_by = EXCLUDED.generated_by, generated_at = demo_now()
         RETURNING generated_at`,
        [ctx.tenantId, scopeKey, branches, day, ctx.locale, JSON.stringify(sheet.facts), JSON.stringify(digest), out.model, out.dropped, ctx.membershipId])).rows[0];
      return { day, compare_day: sheet.compare_day, mode, source, digest, facts: sheet.facts, generated_at: new Date(row.generated_at).toISOString(),
        model: out.model, dropped: out.dropped, regenerations_left: await this.regenLeft(ctx.tenantId), reason: null };
    });
  }

  private offReason(ctx: Ctx): MessageKey | null {
    if (this.ai.mode() === 'sample') return null;
    if (this.ai.mode() === 'live') return 'api.ai.freeTier';
    return this.ai.clinicalOffReason(ctx.tenantId) === 'api.ai.noKey' ? 'api.ai.noKey' : 'api.ai.offMode';
  }

  @Roles('manager') @Get('ai/digest')
  async digest(@CurrentCtx() ctx: Ctx, @Query() q: unknown) {
    const { date, branch_id } = parse(digestQueryZ, q);
    const day = this.digestDay(date);
    const branches = branchScope(ctx, branch_id);
    return { data: await this.digestFor(ctx, day, branches, false) };
  }

  /** A fresh digest (replaces the cached one); at most DIGEST_REGEN_PER_DAY per clinic and day. */
  @Roles('manager') @Post('ai/digest/regenerate') @HttpCode(200)
  async regenerate(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { date, branch_id } = parse(digestQueryZ, body ?? {});
    const day = this.digestDay(date);
    const branches = branchScope(ctx, branch_id);
    const out = await this.digestFor(ctx, day, branches, true);
    await audit(this.db.pool, ctx, 'ai.digest', 'ai', null, `Kun xulosasi qayta yaratildi (${day})`);
    return { data: out };
  }

  /** «Ask the numbers»: a free question (live AI) or a fixed example (any mode) → one whitelisted template. */
  @Roles('manager') @Post('ai/ask') @HttpCode(200)
  async ask(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(askZ, body);
    const scope = branchScope(ctx, b.branch_id);
    const mode = this.ai.managerMode(ctx.tenantId);
    const L = ctx.locale;
    const unsupported = async (reason: 'template' | 'params' | 'question' | 'ai_off', template: string | null) => {
      await audit(this.db.pool, ctx, 'ai.ask', 'ai', null, `Savol rad etildi: ${reason}${template ? ` (${template})` : ''}`);
      return { data: { status: 'unsupported' as const, reason, mode, message: translate(L, `mgrai.ask.unsupported.${reason}` as MessageKey),
        can_ask: TEMPLATE_IDS.map((id) => ({ id, title: translate(L, `mgrai.t.${id}` as MessageKey) })) } };
    };
    let id: string, params: AskParams | undefined;
    if (b.template) {
      id = b.template;
      params = b.params as AskParams | undefined;
    } else {
      if (mode !== 'live') return unsupported('ai_off', null);
      const branches = (await this.db.rows(`SELECT id, name FROM branches WHERE tenant_id = $1 AND id = ANY($2) ORDER BY code`, [ctx.tenantId, ctx.branchIds]));
      const t = today();
      const { value } = await this.ai.json({
        route: 'manager_ask',
        system: `Sen klinika rahbarining savolini tayyor so‘rov shablonlaridan BIRIGA moslaysan. SQL yozma — faqat shablon id va parametrlarini qaytar.
Shablonlar:
${TEMPLATE_HELP}
Umumiy parametrlar: from, to — YYYY-MM-DD (Toshkent vaqti; bugun ${t}; kecha ${addDays(t, -1)}; bu oy ${t.slice(0, 8)}01 dan; kelajak emas, ko‘pi bilan 1 yil); berilmasa oxirgi 30 kun.
branch_id — faqat shu ro‘yxatdagi filial id si, yoki umuman berma (tanlangan filial(lar)): ${JSON.stringify(branches)}. limit 1–20.
Savolga hech bir shablon mos kelmasa (masalan, aniq bemor, tashxis, davolash yoki boshqa mavzu haqida), template = "unsupported" va params = {}.`,
        user: redact(b.question!), schema: PLAN_SCHEMA, validate: planZ, effort: 'low', maxTokens: 600, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
      });
      if (value.template === 'unsupported') return unsupported('question', null);
      id = value.template;
      params = Object.fromEntries(Object.entries(value.params ?? {}).filter(([, v]) => v != null && v !== '')) as AskParams;
    }
    const checked = checkPlan(ctx, id, params, scope);
    if (!checked.ok) return unsupported(checked.reason, checked.reason === 'template' ? null : id);
    const res = await runTemplate(this.db, ctx, checked);
    const facts = rowFacts(res);
    const title = translate(L, `mgrai.t.${id}` as MessageKey);
    let answer = templateAnswer(L, title, res), answerSource: 'model' | 'template' = 'template', dropped = 0;
    // a diagnosis grouping is health data even in aggregate: those rows are shown as a table, never sent to the model
    const clinicalRows = checked.run.group === 'icd_group';
    if (mode === 'live' && res.rows.length && !clinicalRows) {
      try {
        const { value } = await this.ai.json({
          route: 'manager_ask', system: `${ANSWER_SYSTEM}\n${answerLanguage(L)}`,
          user: JSON.stringify({ question: b.question ? redact(b.question) : title, table: title, facts }),
          schema: ANSWER_SCHEMA, validate: answerZ, effort: 'low', maxTokens: 800, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
        });
        const c = checkItems<Item>(value.sentences, facts, 3);
        dropped = c.dropped;
        if (c.kept.length) { answer = c.kept; answerSource = 'model'; }
      } catch { /* the rows stand on their own: the template sentence answers */ }
    }
    await audit(this.db.pool, ctx, 'ai.ask', 'ai', null, `Shablon: ${id}`);
    return { data: { status: 'answered' as const, mode, template: id, title, params: checked.params, columns: res.columns, rows: res.rows, answer, answer_source: answerSource, dropped } };
  }
}

/** The answer without a model: the table's name, its row count and the first money total (summed in tiyin). */
function templateAnswer(L: Ctx['locale'], title: string, res: Result): Item[] {
  if (!res.rows.length) return [{ text: translate(L, 'mgrai.ask.noRows', { title }), fact_keys: ['rows.count'] }];
  const out: Item[] = [{ text: translate(L, 'mgrai.ask.rows', { title, n: res.rows.length }), fact_keys: ['rows.count'] }];
  const money = res.columns.find((c) => c.sum && c.type === 'money');
  if (money) {
    const total = res.rows.reduce((a, r) => a + BigInt(Number(r[money.key] ?? 0)), 0n);
    out.push({ text: translate(L, 'mgrai.ask.total', { sum: formatSom(Number(total), true, L) }), fact_keys: [`total.${money.key}`] });
  }
  return out;
}
