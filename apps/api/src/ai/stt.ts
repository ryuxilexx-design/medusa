// Speech-to-text for doctor dictation. One door, like AiClient: an OpenAI-compatible POST /v1/audio/transcriptions
// on either the clinic's own server (provider «local», the default way: faster-whisper in deploy/docker-compose.prod.yml)
// or OpenAI's cloud (provider «openai», gated like clinical AI). The audio is handed over from memory and dropped —
// never written to disk or the database. One ai_usage row per call: model, seconds, latency, outcome — never the text.
import { Injectable, Logger } from '@nestjs/common';
import type { MessageKey } from '@meduza/contracts';
import { Db } from '../core/db';
import { config } from '../core/config';
import { AppError, coded } from '../core/errors';
import { AiClient, uzQuotes } from './ai-client';

export type SttMode = 'off' | 'local' | 'cloud';
export type SttLanguage = 'uz' | 'ru';
/** Largest recording accepted (a 3-minute webm/opus is under 1 MB; a 3-minute WAV is about 17 MB). */
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
/** The recorder stops at 3 minutes. */
export const AUDIO_MAX_SECONDS = 180;

export type AudioKind = 'webm' | 'ogg' | 'mp4' | 'wav' | 'mpeg';
const MIME: Record<string, AudioKind> = {
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/opus': 'ogg',
  'audio/mp4': 'mp4', 'audio/m4a': 'mp4', 'audio/x-m4a': 'mp4', 'audio/aac': 'mp4', 'video/mp4': 'mp4',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav', 'audio/mpeg': 'mpeg', 'audio/mp3': 'mpeg',
};
const EXT: Record<AudioKind, string> = { webm: 'webm', ogg: 'ogg', mp4: 'm4a', wav: 'wav', mpeg: 'mp3' };
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');
/** The container the bytes really are (the declared type is checked against it). */
function sniff(b: Buffer): AudioKind | null {
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (ascii(b, 4, 8) === 'ftyp') return 'mp4';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') return 'wav';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mpeg';
  return null;
}
/** webm / ogg / mp4 / wav / mpeg whose bytes match the declared type, else null (→ 415). */
export function audioKind(mime: string | undefined, b: Buffer): AudioKind | null {
  const declared = MIME[String(mime ?? '').split(';')[0].trim().toLowerCase()];
  const real = sniff(b);
  return declared && real === declared ? real : null;
}

/**
 * Phrases Whisper is known to «hear» in silence or noise (subtitle credits from its training data). A doctor never
 * dictates them; left in, they would put nonsense into a medical record.
 */
const HALLUCINATIONS = [
  /субтитры (сделал|создавал|делал|подогнал)[^.\n]*\.?/giu, /редактор субтитров[^.\n]*\.?/giu, /корректор [А-ЯЁ]\.\s?[А-ЯЁ][а-яё]+\.?/gu,
  /продолжение следует\.*/giu, /спасибо за (просмотр|внимание)[.!]*/giu, /подписывайтесь на (канал|наш канал)[^.\n]*\.?/giu,
  /(amara\.org|dimatorzok)[^.\n]*\.?/giu, /obuna bo[‘'`ʻ]ling[.!]*/giu,
];
export function cleanTranscript(text: string): string {
  let s = String(text ?? '');
  for (const re of HALLUCINATIONS) s = s.replace(re, ' ');
  return uzQuotes(s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim());
}

/**
 * A short example in the doctor's language and script: Whisper's `prompt` sets the style of the answer (Uzbek in
 * Latin with o‘ g‘, medical words, numbers as digits) without adding content.
 */
const PROMPT: Record<SttLanguage, string> = {
  uz: 'Bemor shikoyatlari: bosh og‘rig‘i, ko‘ngil aynishi. Qon bosimi 140/90, harorat 37,5. Tashxis: o‘tkir bronxit.',
  ru: 'Жалобы пациента: головная боль, тошнота. Давление 140/90, температура 37,5. Диагноз: острый бронхит.',
};

/** USD per audio minute (developers.openai.com/api/docs/pricing, checked 2026-10-23). A local server costs nothing. */
const PRICE_PER_MIN: Record<string, number> = { 'whisper-1': 0.006, 'gpt-4o-transcribe': 0.006, 'gpt-4o-mini-transcribe': 0.003, 'gpt-transcribe': 0.0045 };
/** The gpt-4o transcribe models answer `json` only; Whisper servers answer `verbose_json` with the duration. */
const jsonOnly = (model: string) => /^gpt-4o/.test(model);

const ERR: Record<string, readonly [number, string, MessageKey]> = {
  timeout: [504, 'STT_TIMEOUT', 'api.stt.timeout'],
  busy: [429, 'STT_BUSY', 'api.stt.busy'],
  key: [503, 'STT_KEY', 'api.stt.key'],
  unreachable: [502, 'STT_UNREACHABLE', 'api.stt.unreachable'],
  tooLarge: [413, 'AUDIO_TOO_LARGE', 'api.stt.tooLarge'],
  api: [502, 'STT_ERROR', 'api.stt.error'],
};
class SttError extends Error { constructor(readonly kind: keyof typeof ERR, readonly detail: string) { super(detail); } }

export type Transcribe = {
  audio: Buffer; mime: string; kind: AudioKind; language: SttLanguage;
  /** The length the browser measured (used when the server does not say). */
  clientSeconds?: number;
  tenantId: string; membershipId: string;
};

@Injectable()
export class SttClient {
  private log = new Logger('STT');
  constructor(private db: Db, private ai: AiClient) {}

  /** What is configured: the clinic's own server, the cloud, or nothing usable (no address / no key). */
  private configured(): SttMode {
    const s = config.stt;
    if (s.provider === 'local') return s.baseUrl ? 'local' : 'off';
    if (s.provider === 'openai') return s.apiKey ? 'cloud' : 'off';
    return 'off';
  }

  /** The cloud provider counts as clinical AI: a production server sends patient audio there only with AI_CLINICAL_ALLOWED=1. */
  private blocked(): boolean {
    return this.configured() === 'cloud' && config.mode === 'production' && !config.ai.clinicalInProduction;
  }

  /** The mode the doctor's screen sees; a cloud provider this server may not use counts as off. */
  mode(): SttMode { return this.blocked() ? 'off' : this.configured(); }

  /** Why dictation is off, as a message key for the doctor's screen, or null when it works. */
  offReason(): MessageKey | null {
    if (this.mode() !== 'off') return null;
    if (this.blocked()) return 'api.stt.disabledProduction';
    if (config.stt.provider === 'local') return 'api.stt.noUrl';
    if (config.stt.provider === 'openai') return 'api.stt.noKey';
    return 'api.stt.off';
  }

  /** 503 when dictation cannot run here (checked before the audio is read). */
  assertAvailable() {
    if (this.blocked()) throw coded(503, 'STT_DISABLED_PRODUCTION', 'api.stt.disabledProductionError');
    if (this.mode() === 'off') throw coded(503, 'STT_OFF', 'api.stt.offError');
  }

  /** At most STT_RATE_PER_HOUR dictations per doctor in the last hour (every attempt that reached the STT server counts). */
  async assertRate(membershipId: string) {
    const r = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_usage WHERE route = 'dictation' AND membership_id = $1 AND created_at > (SELECT demo_now()) - interval '1 hour'`, [membershipId]);
    if ((r?.n ?? 0) >= config.stt.ratePerHour) throw coded(429, 'STT_RATE', 'api.stt.rate', { n: config.stt.ratePerHour });
  }

  async transcribe(c: Transcribe): Promise<{ text: string; seconds: number; model: string }> {
    this.assertAvailable();
    const cloud = this.mode() === 'cloud';
    if (cloud) await this.ai.assertBudget(c.tenantId);
    const s = config.stt;
    const model = (c.language === 'uz' ? s.modelUz : s.modelRu) || s.model;
    const started = Date.now();
    const fallbackSeconds = Math.min(Math.max(Number(c.clientSeconds) || 0, 0), AUDIO_MAX_SECONDS + 30);
    let seconds = fallbackSeconds;
    try {
      const form = new FormData();
      // a view of the request's Buffer, not a copy on disk: the audio lives only in this request's memory
      form.append('file', new Blob([c.audio as unknown as Uint8Array<ArrayBuffer>], { type: c.mime.split(';')[0] }), `dictation.${EXT[c.kind]}`);
      form.append('model', model);
      form.append('language', c.language);
      form.append('response_format', jsonOnly(model) ? 'json' : 'verbose_json');
      form.append('temperature', '0');
      form.append('prompt', PROMPT[c.language]);
      let res: Response; let raw = '';
      try {
        res = await fetch(`${s.baseUrl}/v1/audio/transcriptions`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(s.timeoutMs),
          headers: s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {},
        });
        raw = await res.text();
      } catch (e) {
        const name = (e as Error).name;
        throw new SttError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable', name);
      }
      if (!res.ok) {
        const kind = res.status === 429 || res.status === 503 ? 'busy' : res.status === 401 || res.status === 403 ? 'key' : res.status === 413 ? 'tooLarge' : 'api';
        // the server's message names the bad parameter; it never contains the audio or the key
        throw new SttError(kind, `HTTP ${res.status} ${raw.slice(0, 200)}`);
      }
      let json: any;
      try { json = JSON.parse(raw); } catch { throw new SttError('api', 'non-JSON body'); }
      if (typeof json?.text !== 'string') throw new SttError('api', 'no text');
      const lastEnd = Array.isArray(json.segments) && json.segments.length ? Number(json.segments.at(-1)?.end) : NaN;
      const d = Number(json.duration);
      seconds = Number.isFinite(d) && d > 0 ? d : Number.isFinite(lastEnd) && lastEnd > 0 ? lastEnd : fallbackSeconds;
      const text = cleanTranscript(json.text);
      await this.record(c, model, started, seconds, 'ok', text ? null : 'empty');
      if (!text) throw coded(422, 'STT_EMPTY', 'api.stt.empty');
      return { text, seconds: Math.round(seconds * 10) / 10, model };
    } catch (e) {
      if (e instanceof AppError) throw e;
      const kind = e instanceof SttError ? e.kind : 'api';
      const [status, code, key] = ERR[kind];
      this.log.warn(`dictation: ${s.provider} ${e instanceof SttError ? e.detail : (e as Error).name}`);
      await this.record(c, model, started, seconds, 'error', code);
      throw coded(status, code, key);
    }
  }

  private async record(c: Transcribe, model: string, started: number, seconds: number, outcome: 'ok' | 'error', errorCode: string | null) {
    const cloud = this.mode() === 'cloud';
    const price = cloud ? PRICE_PER_MIN[model] : 0;
    const cost = price === undefined ? null : outcome === 'ok' ? (seconds / 60) * price : 0;
    await this.db.rows(
      `INSERT INTO ai_usage (tenant_id, membership_id, route, model, cost_usd, latency_ms, outcome, error_code, audio_seconds)
       VALUES ($1,$2,'dictation',$3,$4,$5,$6,$7,$8)`,
      [c.tenantId, c.membershipId || null, `${cloud ? 'openai' : 'local'}:${model}`, cost, Date.now() - started, outcome, errorCode, Math.round(seconds * 10) / 10],
    ).catch((err) => this.log.error(`ai_usage insert failed: ${err}`));
  }
}
