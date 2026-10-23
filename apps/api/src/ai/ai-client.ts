// One door to the model for every AI feature: structured JSON output validated against a schema, refusal and
// error handling, and a usage row per call (tokens + estimated cost, never the prompt or the answer).
// Two providers behind the same call: Claude (official Anthropic SDK) and Gemini (REST generateContent).
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { ZodType } from 'zod';
import { Db } from '../core/db';
import { config } from '../core/config';
import { AppError, coded } from '../core/errors';
import type { MessageKey } from '@meduza/contracts';
import { SEED_IDS } from '@meduza/db';

export type AiMode = 'off' | 'sample' | 'live';
export type AiRoute = 'note_draft' | 'icd10_suggest' | 'news_summary' | 'bot_faq';
/** Routes that carry only public text: PubMed abstracts, and the bot's clinic FAQ (the clinic's own price list/hours plus a
 * redacted question already screened for medical content — telegram/faq.ts). Every other route counts as clinical. */
const PUBLIC_ROUTES = new Set<AiRoute>(['news_summary', 'bot_faq']);
const SEED_TENANTS = new Set<string>([SEED_IDS.tenant, SEED_IDS.tenant2]);
/** Why clinical text may not go to the model: the server is a production one without AI_CLINICAL_ALLOWED=1, or the Gemini free tier. */
export type ClinicalBlock = 'production' | 'free_tier';
/** The refusal for clinical text (status reason, note draft and json() all use it); the filter answers in the person's language. */
export const clinicalBlockError = (block: ClinicalBlock) =>
  block === 'production' ? coded(503, 'AI_DISABLED_PRODUCTION', 'api.ai.disabledProduction') : coded(503, 'AI_NOT_ALLOWED', 'api.ai.freeTier');

/**
 * USD per 1M tokens, paid tier. Unknown models are metered without a cost. Gemini bills thinking tokens as output;
 * its free tier costs nothing, so there the figure is what the same traffic would cost on the paid tier.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // ai.google.dev/gemini-api/docs/pricing, checked 2026-10-19 (3.8 Flash doubles on 2027-01-01). Free tier: billed 0.
  'gemini-3.8-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
};
/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). Haiku has none. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
/** Gemini answers that mean "will not answer" rather than "answer cut short". */
const GEMINI_REFUSALS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);

export type JsonCall<T> = {
  route: AiRoute;
  system: string;
  /** Mark the system prompt for prompt caching (long, stable prompts such as the ICD-10 list). Gemini caches implicitly. */
  cacheSystem?: boolean;
  user: string;
  schema: Record<string, unknown>;
  validate: ZodType<T>;
  effort: 'low' | 'medium' | 'high';
  maxTokens?: number;
  tenantId: string | null;
  membershipId: string | null;
};

type Meter = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };
/** What a provider returned, before validation. */
type Raw = { text: string | undefined; end: 'ok' | 'refusal' | 'max_tokens'; refusalCategory: string | null };
/** Provider failures → HTTP status, error code and the message key (`api.ai.*`, translated by the error filter). */
const ERR: Record<string, readonly [number, string, MessageKey]> = {
  timeout: [504, 'AI_TIMEOUT', 'api.ai.timeout'],
  busy: [429, 'AI_BUSY', 'api.ai.busy'],
  key: [503, 'AI_KEY', 'api.ai.key'],
  unreachable: [502, 'AI_UNREACHABLE', 'api.ai.unreachable'],
  api: [502, 'AI_ERROR', 'api.ai.error'],
  unexpected: [500, 'AI_ERROR', 'api.ai.unexpected'],
};
/**
 * Models often write Uzbek with ASCII apostrophes; the UI uses o‘ g‘ and ’ (ma’lumot). Applied to every string answered.
 * An English possessive ('s at a word end: Hodgkin's, dog's) keeps the plain right quote ’.
 */
export const uzQuotes = (s: string) => s.replace(/([oOgG])['`ʻʼ‘’](?!s\b)/g, '$1‘').replace(/(\p{L})['`ʼ](?=\p{L})/gu, '$1’');
const mapStrings = (v: unknown): unknown =>
  typeof v === 'string' ? uzQuotes(v) : Array.isArray(v) ? v.map(mapStrings)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x)])) : v;
class ProviderError extends Error {
  constructor(readonly kind: keyof typeof ERR, readonly detail: string) { super(detail); }
}

@Injectable()
export class AiClient {
  private log = new Logger('AI');
  private sdk: Anthropic | null = null;
  private sdkKey = '';
  constructor(private db: Db) {}

  /** live needs a key; without one the features fall back to their non-AI behaviour. */
  mode(): AiMode {
    if (config.ai.mode === 'live' && !config.ai.apiKey) return 'off';
    return config.ai.mode;
  }

  /**
   * Why clinical text (even de-identified) of this tenant may not go to the current provider, or null when it may.
   * A production server sends clinical text only when the clinic switched it on (AI_CLINICAL_ALLOWED=1). The Gemini
   * free tier gets it only when it is synthetic: a seed demo tenant on a non-production deployment (Google may use
   * free-tier prompts to improve its products, and a real clinic can be onboarded on a demo deployment too).
   */
  clinicalBlock(tenantId: string | null): ClinicalBlock | null {
    if (config.mode === 'production' && !config.ai.clinicalInProduction) return 'production';
    if (config.ai.provider !== 'gemini' || config.ai.geminiPaid) return null;
    return config.mode !== 'production' && !!tenantId && SEED_TENANTS.has(tenantId) ? null : 'free_tier';
  }

  clinicalAllowed(tenantId: string | null): boolean { return this.clinicalBlock(tenantId) === null; }

  /** The error a clinical route answers when its text may not leave the server. */
  clinicalError(tenantId: string | null): AppError { return clinicalBlockError(this.clinicalBlock(tenantId) ?? 'production'); }

  /** The mode clinical features see: a provider that may not receive this tenant's clinical text counts as off. */
  clinicalMode(tenantId: string | null): AiMode {
    const m = this.mode();
    return m === 'live' && !this.clinicalAllowed(tenantId) ? 'off' : m;
  }

  /** Why clinical AI is off for this tenant, as a message key for the doctor's screen (translated by the caller). */
  clinicalOffReason(tenantId: string | null): MessageKey | null {
    if (this.clinicalMode(tenantId) !== 'off') return null;
    if (this.mode() === 'live') return this.clinicalBlock(tenantId) === 'production' ? 'api.ai.disabledProduction' : 'api.ai.freeTier';
    return config.ai.mode === 'live' ? 'api.ai.noKey' : 'api.ai.offMode';
  }

  /** Today's spend of a clinic (Tashkent day) against AI_DAILY_LIMIT_USD; news (no tenant) is not capped per clinic. */
  async assertBudget(tenantId: string | null) {
    if (!tenantId || !(config.ai.dailyLimitUsd > 0)) return;
    const r = await this.db.one<{ spent: string }>(
      `SELECT coalesce(sum(cost_usd), 0)::text AS spent FROM ai_usage
        WHERE tenant_id = $1 AND created_at >= date_trunc('day', demo_now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'`, [tenantId]);
    if (Number(r?.spent ?? 0) >= config.ai.dailyLimitUsd) throw coded(429, 'AI_BUDGET', 'api.ai.budget');
  }

  /** One structured request. Throws AppError (AI_*) the UI can show; the caller keeps the user's own text. */
  async json<T>(c: JsonCall<T>): Promise<{ value: T; model: string }> {
    if (this.mode() !== 'live') throw coded(503, 'AI_OFF', 'api.ai.off');
    if (!PUBLIC_ROUTES.has(c.route)) { const block = this.clinicalBlock(c.tenantId); if (block) throw clinicalBlockError(block); }
    await this.assertBudget(c.tenantId);
    const started = Date.now();
    const meter: Meter = { model: config.ai.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    try {
      const raw = config.ai.provider === 'gemini' ? await this.gemini(c, meter) : await this.anthropic(c, meter);
      if (raw.end === 'refusal') {
        await this.record(c, meter, started, 'refusal', raw.refusalCategory);
        throw coded(502, 'AI_REFUSED', 'api.ai.refused');
      }
      let parsed: unknown;
      try { parsed = JSON.parse(raw.text ?? ''); } catch { parsed = undefined; }
      const ok = raw.end !== 'max_tokens' ? c.validate.safeParse(parsed) : null;
      if (!ok || !ok.success) {
        await this.record(c, meter, started, 'bad_output', raw.end === 'max_tokens' ? 'max_tokens' : 'schema');
        throw coded(502, 'AI_BAD_OUTPUT', 'api.ai.badOutput');
      }
      await this.record(c, meter, started, 'ok', null);
      return { value: mapStrings(ok.data) as T, model: meter.model };
    } catch (e) {
      if (e instanceof AppError) throw e;
      const kind = e instanceof ProviderError ? e.kind : 'unexpected';
      const [status, code, key] = ERR[kind];
      this.log.warn(`${c.route}: ${config.ai.provider} ${e instanceof ProviderError ? e.detail : (e as Error).name}`);
      await this.record(c, meter, started, 'error', code);
      throw coded(status, code, key);
    }
  }

  // ---------- Claude ----------

  private client(): Anthropic {
    const key = `${config.ai.apiKey}|${config.ai.baseUrl}|${config.ai.timeoutMs}`;
    if (!this.sdk || this.sdkKey !== key) {
      this.sdk = new Anthropic({ apiKey: config.ai.apiKey, baseURL: config.ai.baseUrl || undefined, timeout: config.ai.timeoutMs, maxRetries: 1 });
      this.sdkKey = key;
    }
    return this.sdk;
  }

  private async anthropic(c: JsonCall<unknown>, meter: Meter): Promise<Raw> {
    const model = config.ai.model;
    let response: any;
    try {
      response = await this.client().beta.messages.create({
        model,
        max_tokens: c.maxTokens ?? 4000,
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        output_config: { effort: c.effort, format: { type: 'json_schema', schema: c.schema } },
        system: c.cacheSystem ? [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }] : c.system,
        messages: [{ role: 'user', content: c.user }],
      } as any);
    } catch (e) {
      const status = (e as any).status ?? '';
      throw new ProviderError(
        e instanceof Anthropic.APIConnectionTimeoutError ? 'timeout'
        : e instanceof Anthropic.RateLimitError ? 'busy'
        : e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError ? 'key'
        : e instanceof Anthropic.APIConnectionError ? 'unreachable'
        : e instanceof Anthropic.APIError ? 'api' : 'unexpected', `${(e as Error).name} ${status}`);
    }
    meter.model = response.model ?? model;
    meter.input = response.usage?.input_tokens ?? 0;
    meter.output = response.usage?.output_tokens ?? 0;
    meter.cacheRead = response.usage?.cache_read_input_tokens ?? 0;
    meter.cacheWrite = response.usage?.cache_creation_input_tokens ?? 0;
    if (response.stop_reason === 'refusal') return { text: undefined, end: 'refusal', refusalCategory: response.stop_details?.category ?? null };
    return {
      text: (response.content as any[]).find((b) => b.type === 'text')?.text,
      end: response.stop_reason === 'max_tokens' ? 'max_tokens' : 'ok', refusalCategory: null,
    };
  }

  // ---------- Gemini ----------

  private async gemini(c: JsonCall<unknown>, meter: Meter): Promise<Raw> {
    const model = config.ai.model;
    const base = (config.ai.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const body = {
      systemInstruction: { parts: [{ text: c.system }] },
      contents: [{ role: 'user', parts: [{ text: c.user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: c.schema,
        maxOutputTokens: c.maxTokens ?? 4000,
        // Gemini 3+ thinks at "high" by default (~30 s for a note); "low" keeps it within the timeout. Older and
        // non-Gemini models (2.x, gemma, tuned) reject thinkingLevel, so it is sent only to gemini-3 and later.
        ...(/^gemini-([3-9]|\d{2,})/.test(model) ? { thinkingConfig: { thinkingLevel: c.effort === 'low' ? 'low' : 'high' } } : {}),
      },
    };
    // one time budget for the whole call (headers and body), including the single retry of a 503 ("model overloaded")
    const deadline = Date.now() + config.ai.timeoutMs;
    const signal = AbortSignal.timeout(config.ai.timeoutMs);
    let res!: Response;
    let raw = '';
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': config.ai.apiKey },
          body: JSON.stringify(body),
          signal,
        });
        raw = await res.text();
      } catch (e) {
        const name = (e as Error).name;
        throw new ProviderError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable', name);
      }
      // retry once, and only if a real call still fits in the budget (1 s pause + ~3 s answer)
      if (res.status !== 503 || attempt > 0 || deadline - Date.now() < 4000) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    let json: any;
    try { json = JSON.parse(raw); } catch { json = null; }
    if (!res.ok) {
      const reason = json?.error?.details?.find((d: any) => d?.reason)?.reason ?? json?.error?.status ?? '';
      const kind = res.status === 429 || res.status === 503 ? 'busy'
        : res.status === 401 || res.status === 403 || /API_KEY/.test(reason) ? 'key'
        : 'api';
      // Google's message names the bad field (e.g. an unsupported thinking level); it never contains the key
      throw new ProviderError(kind, `HTTP ${res.status} ${reason} ${String(json?.error?.message ?? '').slice(0, 200)}`);
    }
    if (!json) throw new ProviderError('api', `HTTP ${res.status} non-JSON body`);
    const u = json?.usageMetadata ?? {};
    meter.model = json?.modelVersion ?? model;
    meter.cacheRead = u.cachedContentTokenCount ?? 0;
    meter.input = Math.max(0, (u.promptTokenCount ?? 0) - meter.cacheRead);
    meter.output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const blocked = json?.promptFeedback?.blockReason;
    const cand = json?.candidates?.[0];
    const finish: string = cand?.finishReason ?? '';
    if (blocked || GEMINI_REFUSALS.has(finish)) return { text: undefined, end: 'refusal', refusalCategory: String(blocked || finish).toLowerCase() };
    const text = ((cand?.content?.parts ?? []) as any[]).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    return { text, end: finish === 'MAX_TOKENS' ? 'max_tokens' : 'ok', refusalCategory: null };
  }

  private async record(c: JsonCall<unknown>, m: Meter, started: number, outcome: string, errorCode: string | null) {
    // dated or versioned names (claude-…-20261001, gemini-…-001, gemini-…-preview-09-2026) price as their base model
    const p = PRICES[m.model] ?? PRICES[m.model.replace(/-\d{8}$|-\d{3}$|-preview(-\d{2}-\d{4})?$/, '')];
    const freeTier = config.ai.provider === 'gemini' && !config.ai.geminiPaid;
    const cost = freeTier ? 0 : p ? (m.input * p.input + m.output * p.output + m.cacheRead * p.cacheRead + m.cacheWrite * p.cacheWrite) / 1e6 : null;
    await this.db.rows(
      `INSERT INTO ai_usage (tenant_id, membership_id, route, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, outcome, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [c.tenantId, c.membershipId || null, c.route, m.model, m.input, m.output, m.cacheRead, m.cacheWrite, cost, Date.now() - started, outcome, errorCode],
    ).catch((err) => this.log.error(`ai_usage insert failed: ${err}`));
  }
}
