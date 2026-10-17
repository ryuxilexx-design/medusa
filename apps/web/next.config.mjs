import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // A separate build dir lets the isolated E2E stack run next to the demo server without touching its build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // The browser only talks to this origin; /api/v1 is proxied to the NestJS API so the HttpOnly session cookie stays first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }];
  },
  outputFileTracingRoot: path.resolve(here, '../..'),
};
