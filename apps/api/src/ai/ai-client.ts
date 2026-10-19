// One door to Claude for every AI feature: structured JSON output validated against a schema, refusal and
// error handling, and a usage row per call (tokens + estimated cost, never the prompt or the answer).
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { ZodType } from 'zod';
import { Db } from '../core/db';
import { config } from '../core/config';
import { AppError } from '../core/errors';

export type AiMode = 'off' | 'sample' | 'live';
export type AiRoute = 'note_draft' | 'icd10_suggest' | 'news_summary';

/** USD per 1M tokens (Anthropic first-party API). Unknown models are metered without a cost. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). Haiku has none. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

export type JsonCall<T> = {
  route: AiRoute;
  system: string;
  /** Mark the system prompt for prompt caching (long, stable prompts such as the ICD-10 list). */
  cacheSystem?: boolean;
  user: string;
  schema: Record<string, unknown>;
  validate: ZodType<T>;
  effort: 'low' | 'medium' | 'high';
  maxTokens?: number;
  tenantId: string | null;
  membershipId: string | null;
};

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

  private client(): Anthropic {
    const key = `${config.ai.apiKey}|${config.ai.baseUrl}|${config.ai.timeoutMs}`;
    if (!this.sdk || this.sdkKey !== key) {
      this.sdk = new Anthropic({ apiKey: config.ai.apiKey, baseURL: config.ai.baseUrl || undefined, timeout: config.ai.timeoutMs, maxRetries: 1 });
      this.sdkKey = key;
    }
    return this.sdk;
  }

  /** One structured request. Throws AppError (AI_*) the UI can show; the caller keeps the user's own text. */
  async json<T>(c: JsonCall<T>): Promise<{ value: T; model: string }> {
    if (this.mode() !== 'live') throw new AppError(503, 'AI_OFF', 'AI ulanmagan.');
    const model = config.ai.model;
    const started = Date.now();
    const meter = { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    try {
      const response: any = await this.client().beta.messages.create({
        model,
        max_tokens: c.maxTokens ?? 4000,
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        output_config: { effort: c.effort, format: { type: 'json_schema', schema: c.schema } },
        system: c.cacheSystem ? [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }] : c.system,
        messages: [{ role: 'user', content: c.user }],
      } as any);
      meter.model = response.model ?? model;
      meter.input = response.usage?.input_tokens ?? 0;
      meter.output = response.usage?.output_tokens ?? 0;
      meter.cacheRead = response.usage?.cache_read_input_tokens ?? 0;
      meter.cacheWrite = response.usage?.cache_creation_input_tokens ?? 0;
      if (response.stop_reason === 'refusal') {
        await this.record(c, meter, started, 'refusal', response.stop_details?.category ?? null);
        throw new AppError(502, 'AI_REFUSED', 'AI bu so‘rovni bajarmadi. Qo‘lda davom ettiring.');
      }
      const text = (response.content as any[]).find((b) => b.type === 'text')?.text;
      let parsed: unknown;
      try { parsed = JSON.parse(text ?? ''); } catch { parsed = undefined; }
      const ok = response.stop_reason !== 'max_tokens' ? c.validate.safeParse(parsed) : null;
      if (!ok || !ok.success) {
        await this.record(c, meter, started, 'bad_output', response.stop_reason === 'max_tokens' ? 'max_tokens' : 'schema');
        throw new AppError(502, 'AI_BAD_OUTPUT', 'AI javobi to‘liq emas. Qayta urinib ko‘ring yoki qo‘lda davom ettiring.');
      }
      await this.record(c, meter, started, 'ok', null);
      return { value: ok.data, model: meter.model };
    } catch (e) {
      if (e instanceof AppError) throw e;
      const [status, code, message] =
        e instanceof Anthropic.APIConnectionTimeoutError ? [504, 'AI_TIMEOUT', 'AI javob bermadi (vaqt tugadi). Qo‘lda davom ettiring.']
        : e instanceof Anthropic.RateLimitError ? [429, 'AI_BUSY', 'AI hozir band yoki oylik limit tugagan. Birozdan keyin urinib ko‘ring.']
        : e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError ? [503, 'AI_KEY', 'AI kaliti noto‘g‘ri yoki bekor qilingan. Administratorga xabar bering.']
        : e instanceof Anthropic.APIConnectionError ? [502, 'AI_UNREACHABLE', 'AI xizmatiga ulanib bo‘lmadi. Internetni tekshiring yoki qo‘lda davom ettiring.']
        : e instanceof Anthropic.APIError ? [502, 'AI_ERROR', 'AI xizmatida xato. Qo‘lda davom ettiring.']
        : [500, 'AI_ERROR', 'AI so‘rovida kutilmagan xato.'];
      this.log.warn(`${c.route}: ${(e as Error).name} ${(e as any).status ?? ''}`);
      await this.record(c, meter, started, 'error', code as string);
      throw new AppError(status as number, code as string, message as string);
    }
  }

  private async record(c: JsonCall<unknown>, m: { model: string; input: number; output: number; cacheRead: number; cacheWrite: number }, started: number, outcome: string, errorCode: string | null) {
    const p = PRICES[m.model] ?? PRICES[m.model.replace(/-\d{8}$/, '')];
    const cost = p ? (m.input * p.input + m.output * p.output + m.cacheRead * p.cacheRead + m.cacheWrite * p.cacheWrite) / 1e6 : null;
    await this.db.rows(
      `INSERT INTO ai_usage (tenant_id, membership_id, route, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, outcome, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [c.tenantId, c.membershipId || null, c.route, m.model, m.input, m.output, m.cacheRead, m.cacheWrite, cost, Date.now() - started, outcome, errorCode],
    ).catch((err) => this.log.error(`ai_usage insert failed: ${err}`));
  }
}
