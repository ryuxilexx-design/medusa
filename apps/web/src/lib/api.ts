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
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Server bilan aloqa yo‘q. Ma’lumot saqlanmadi — internet/serverni tekshirib, qayta urinib ko‘ring.');
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = json?.error;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/demo/login') && !path.startsWith('/auth/')) window.dispatchEvent(new Event('meduza:unauthorized'));
    if (e?.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') window.dispatchEvent(new Event('meduza:password-change'));
    throw new ApiError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? (res.status >= 500 ? 'Server xatosi. Qayta urinib ko‘ring.' : 'So‘rov bajarilmadi'), e?.fields, e?.details, json?.request_id);
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
