import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const mode = (process.env.APP_MODE || 'demo') as 'development' | 'demo' | 'production';
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
  ai: {
    mode: (process.env.AI_MODE || 'sample') as 'off' | 'sample' | 'live',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-opus-5-5',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
  },
};
