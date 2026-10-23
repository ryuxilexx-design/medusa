import * as path from 'path';
import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

function packageVersion(): string {
  try { return String(JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).version || '0'); } catch { return '0'; }
}

const mode = (process.env.APP_MODE || 'demo') as 'development' | 'demo' | 'production';
const sttProvider = (process.env.STT_PROVIDER || 'off') as 'off' | 'local' | 'openai';
if (!['off', 'local', 'openai'].includes(sttProvider)) throw new Error(`STT_PROVIDER must be off, local or openai, got "${sttProvider}"`);
const aiProvider = (process.env.AI_PROVIDER || 'anthropic') as 'anthropic' | 'gemini';
if (aiProvider !== 'anthropic' && aiProvider !== 'gemini') throw new Error(`AI_PROVIDER must be anthropic or gemini, got "${aiProvider}"`);
export const config = {
  port: Number(process.env.API_PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://meduza:meduza_local@127.0.0.1:5433/meduza',
  mode,
  demoEnabled: mode !== 'production',
  demoDate: process.env.DEMO_DATE || '2026-10-18',
  demoTime: process.env.DEMO_TIME || '',
  /** Idle lifetime of a session: every request (at most once a minute) extends it by this much … */
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  /** … but never beyond this many hours after sign-in (at least the idle lifetime). */
  sessionMaxHours: Math.max(Number(process.env.SESSION_MAX_HOURS || 14), Number(process.env.SESSION_TTL_HOURS || 12)),
  /** One structured line per request (method, path, status, ms, request id, tenant — never a body). off in tests. */
  requestLog: process.env.REQUEST_LOG !== 'off' && process.env.MEDUZA_TEST !== '1',
  /** Shown by GET /health: APP_VERSION (set by the deploy) or the package version. */
  version: process.env.APP_VERSION || packageVersion(),
  /** If set, demo role login requires this code (use it whenever the demo is reachable from the internet). */
  demoAccessCode: process.env.DEMO_ACCESS_CODE || '',
  /** Mark the session cookie Secure (behind HTTPS, e.g. Railway). */
  cookieSecure: process.env.COOKIE_SECURE === '1' || mode === 'production',
  /** Seed the demo data automatically when the database is empty (first deploy). */
  autoSeed: process.env.AUTO_SEED === '1',
  /** Public address of this server (https://klinika.example.uz): cameras push events to <it>/api/v1/hik/<token>. Empty = taken from the request. */
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  /** 32-byte key (base64) for encrypting stored secrets such as Telegram bot tokens. Without it a real bot cannot be connected. */
  secretKey: process.env.APP_SECRET_KEY || '',
  /** Background workers (Telegram polling, reminders, outbox, daily news). Off in tests: tests drive them directly. */
  workers: (process.env.BACKGROUND_WORKERS ?? process.env.TELEGRAM_WORKERS) !== 'off' && process.env.MEDUZA_TEST !== '1',
  telegram: {
    workers: (process.env.BACKGROUND_WORKERS ?? process.env.TELEGRAM_WORKERS) !== 'off' && process.env.MEDUZA_TEST !== '1',
    apiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
  },
  sms: {
    /** Eskiz.uz gateway. The base URL changes only for tests (fake server) or a proxy. */
    baseUrl: (process.env.ESKIZ_BASE_URL || 'https://notify.eskiz.uz').replace(/\/+$/, ''),
    timeoutMs: Number(process.env.ESKIZ_TIMEOUT_MS || 10000),
  },
  ai: {
    /** off | sample | live. A production server starts with AI off; the demo shows the sample result. */
    mode: (process.env.AI_MODE || (mode === 'production' ? 'off' : 'sample')) as 'off' | 'sample' | 'live',
    /** APP_MODE=production refuses clinical routes (note draft, ICD-10) unless the clinic explicitly allowed them. News still works. */
    clinicalInProduction: process.env.AI_CLINICAL_ALLOWED === '1',
    /** Per-clinic daily spend cap in USD, summed from ai_usage before each call; 0 = no cap. */
    dailyLimitUsd: process.env.AI_DAILY_LIMIT_USD === undefined || process.env.AI_DAILY_LIMIT_USD === '' ? 5 : Number(process.env.AI_DAILY_LIMIT_USD),
    /** anthropic (Claude) | gemini. Each provider has its own key and model variable, so switching is one line. */
    provider: aiProvider,
    apiKey: (aiProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY) || '',
    model: (aiProvider === 'gemini' ? process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite' : process.env.AI_MODEL || 'claude-sonnet-5-5'),
    /** Gemini free tier lets Google use prompts to improve its products: no patient text there in production. */
    geminiPaid: process.env.GEMINI_PAID === '1',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
    /** Only for tests/proxies; empty = the provider's own API. Per provider, so a key never goes to the other one's proxy. */
    baseUrl: (aiProvider === 'gemini' ? process.env.GEMINI_BASE_URL : process.env.AI_BASE_URL) || '',
  },
  stt: {
    /**
     * Doctor dictation (speech-to-text). local = an OpenAI-compatible server on the clinic's own machine (the `stt`
     * service of deploy/docker-compose.prod.yml): the audio never leaves the clinic, allowed for clinical audio
     * everywhere. openai = OpenAI's cloud API, gated exactly like clinical AI (production needs AI_CLINICAL_ALLOWED=1).
     */
    provider: sttProvider,
    /** local: e.g. http://stt:8000 (compose) or http://127.0.0.1:8000; openai: empty = https://api.openai.com. */
    baseUrl: (process.env.STT_BASE_URL || (sttProvider === 'openai' ? 'https://api.openai.com' : sttProvider === 'local' ? 'http://stt:8000' : '')).replace(/\/+$/, ''),
    model: process.env.STT_MODEL || (sttProvider === 'openai' ? 'whisper-1' : 'Systran/faster-whisper-large-v3'),
    /**
     * Per-language model (empty = STT_MODEL). Stock Whisper is good at Russian but weak at Uzbek, so a local server
     * usually runs an Uzbek fine-tune for uz and large-v3 for ru (docs/VOICE_SCRIBE.md).
     */
    modelUz: process.env.STT_MODEL_UZ || '',
    modelRu: process.env.STT_MODEL_RU || '',
    /** Optional for local (a server behind a key); required for openai (STT_API_KEY or OPENAI_API_KEY). */
    // the OpenAI key goes only to OpenAI's own host, never to a custom STT_BASE_URL
    apiKey: process.env.STT_API_KEY || (sttProvider === 'openai' && /^https:\/\/api\.openai\.com(\/|$)/.test(process.env.STT_BASE_URL || 'https://api.openai.com') ? process.env.OPENAI_API_KEY || '' : ''),
    /** A CPU-only server needs up to ~1 minute for a 3-minute recording with large-v3. */
    timeoutMs: Number(process.env.STT_TIMEOUT_MS || 120000),
    /** Dictations per doctor per hour. */
    ratePerHour: Number(process.env.STT_RATE_PER_HOUR || 30),
  },
  fiscal: {
    /**
     * Deployment default for fiscal receipts (a clinic may override it in tenants.fiscal_provider):
     * manual = parallel mode, the cashier records the certified KKM receipt number; none = no fiscalisation (demo).
     * A real ОФД provider is added as another name without schema changes.
     */
    provider: process.env.FISCAL_PROVIDER || (mode === 'production' ? 'manual' : 'none'),
    /** How often the outbox worker retries pending rows of automatic providers (seconds). */
    retrySeconds: Number(process.env.FISCAL_RETRY_SECONDS || 60),
  },
  dhp: {
    /** Digital Health Platform (DMED) outbox: how often the worker runs, and the per-request timeout. */
    intervalSeconds: Number(process.env.DHP_INTERVAL_SECONDS || 60),
    timeoutMs: Number(process.env.DHP_TIMEOUT_MS || 15000),
  },
  news: {
    /** Daily specialty news for doctors (PubMed + AI summary). off = no fetching. */
    enabled: process.env.NEWS_ENABLED !== 'off',
    pubmedBase: process.env.PUBMED_BASE || 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
    /** Optional NCBI key: raises the E-utilities limit from 3 to 10 requests/second. */
    ncbiKey: process.env.NCBI_API_KEY || '',
  },
};
