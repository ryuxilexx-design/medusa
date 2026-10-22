import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const mode = (process.env.APP_MODE || 'demo') as 'development' | 'demo' | 'production';
const aiProvider = (process.env.AI_PROVIDER || 'anthropic') as 'anthropic' | 'gemini';
if (aiProvider !== 'anthropic' && aiProvider !== 'gemini') throw new Error(`AI_PROVIDER must be anthropic or gemini, got "${aiProvider}"`);
export const config = {
  port: Number(process.env.API_PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://meduza:meduza_local@127.0.0.1:5433/meduza',
  mode,
  demoEnabled: mode !== 'production',
  demoDate: process.env.DEMO_DATE || '2026-10-18',
  demoTime: process.env.DEMO_TIME || '',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
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
  ai: {
    mode: (process.env.AI_MODE || 'sample') as 'off' | 'sample' | 'live',
    /** anthropic (Claude) | gemini. Each provider has its own key and model variable, so switching is one line. */
    provider: aiProvider,
    apiKey: (aiProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY) || '',
    model: (aiProvider === 'gemini' ? process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite' : process.env.AI_MODEL || 'claude-opus-5-5'),
    /** Gemini free tier lets Google use prompts to improve its products: no patient text there in production. */
    geminiPaid: process.env.GEMINI_PAID === '1',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
    /** Only for tests/proxies; empty = the provider's own API. Per provider, so a key never goes to the other one's proxy. */
    baseUrl: (aiProvider === 'gemini' ? process.env.GEMINI_BASE_URL : process.env.AI_BASE_URL) || '',
  },
  news: {
    /** Daily specialty news for doctors (PubMed + AI summary). off = no fetching. */
    enabled: process.env.NEWS_ENABLED !== 'off',
    pubmedBase: process.env.PUBMED_BASE || 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
    /** Optional NCBI key: raises the E-utilities limit from 3 to 10 requests/second. */
    ncbiKey: process.env.NCBI_API_KEY || '',
  },
};
