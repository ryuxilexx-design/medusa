import { translate } from '@meduza/contracts';
import { formatLocale } from './format';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public details?: any, public requestId?: string) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };

/** Thin fetch wrapper. All data comes from the server; nothing clinical or financial is persisted in the browser. */
export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      // a FormData body (a recording) goes as multipart: the browser sets the content type with its boundary
      headers: { ...(opts.body !== undefined && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', translate(formatLocale(), 'net.offline'));
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = json?.error;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/demo/login') && !path.startsWith('/auth/')) window.dispatchEvent(new Event('meduza:unauthorized'));
    if (e?.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') window.dispatchEvent(new Event('meduza:password-change'));
    throw new ApiError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? translate(formatLocale(), res.status >= 500 ? 'net.serverError' : 'net.failed'), e?.fields, e?.details, json?.request_id);
  }
  return json as T;
}

export const qs = (params: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const newIdempotencyKey = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
