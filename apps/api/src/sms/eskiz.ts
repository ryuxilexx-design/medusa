// Eskiz.uz SMS gateway (https://notify.eskiz.uz). Token: POST /api/auth/login {email, password} → data.token (Bearer,
// valid for a month); an expired/revoked token answers 401 and is renewed by logging in again — once per call.
// Send: POST /api/message/sms/send {mobile_phone: 998XXXXXXXXX, message, from, callback_url?} → {id, status}.
// Status: GET /api/message/sms/status_by_id/:id → data.status (DELIVRD, UNDELIV, EXPIRED, REJECTD, …).
// The base URL is configurable (ESKIZ_BASE_URL) so tests talk to a local fake server; redirects are never followed
// (a redirect would carry the Bearer token to another host).
import { config } from '../core/config';

/** `status` is the HTTP status (0 = network/timeout). 5xx, 429 and network errors are retryable; 4xx is the account's or the message's fault. */
export class EskizError extends Error {
  constructor(public status: number, public detail: string) { super(`Eskiz ${status}: ${detail}`); }
  get retryable() { return this.status === 0 || this.status >= 500 || this.status === 429; }
}

export type EskizCredentials = { email: string; password: string };
export type SendResult = { id: string | null; status: string };

/** Final states as Eskiz reports them (SMPP names). */
export const DELIVERED_STATES = new Set(['DELIVRD', 'DELIVERED']);
export const UNDELIVERED_STATES = new Set(['UNDELIV', 'EXPIRED', 'REJECTD', 'DELETED', 'UNKNOWN', 'REJECTED']);

export class EskizClient {
  private token: string | null = null;
  private loggingIn: Promise<string> | null = null;
  constructor(private creds: EskizCredentials, private baseUrl = config.sms.baseUrl, private timeoutMs = config.sms.timeoutMs) {}

  /** The credentials this client was built with (the registry drops a client whose settings changed). */
  matches(c: EskizCredentials) { return this.creds.email === c.email && this.creds.password === c.password; }

  private async request(path: string, init: { method: string; body?: unknown; auth?: boolean }): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.auth) headers.authorization = `Bearer ${await this.getToken()}`;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e: any) {
      throw new EskizError(0, e?.name === 'TimeoutError' ? 'timeout' : 'network error');
    }
    if (res.status >= 300 && res.status < 400) throw new EskizError(res.status, 'unexpected redirect');
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  /** Logs in (once at a time); the token is kept in memory only. */
  async login(): Promise<string> {
    if (this.loggingIn) return this.loggingIn;
    this.loggingIn = (async () => {
      const { status, json } = await this.request('/api/auth/login', { method: 'POST', body: { email: this.creds.email, password: this.creds.password } });
      const token = json?.data?.token;
      if (status >= 200 && status < 300 && typeof token === 'string' && token) { this.token = token; return token; }
      this.token = null;
      throw new EskizError(status || 0, String(json?.message ?? json?.data?.message ?? 'login failed').slice(0, 200));
    })();
    try { return await this.loggingIn; } finally { this.loggingIn = null; }
  }
  private getToken() { return this.token ? Promise.resolve(this.token) : this.login(); }

  /** An authorised call; a 401 renews the token and retries exactly once. */
  private async authed(path: string, init: { method: string; body?: unknown }) {
    let r = await this.request(path, { ...init, auth: true });
    if (r.status === 401) { this.token = null; await this.login(); r = await this.request(path, { ...init, auth: true }); }
    if (r.status >= 200 && r.status < 300) return r.json;
    throw new EskizError(r.status, String(r.json?.message ?? r.json?.data?.message ?? r.json?.error ?? 'error').slice(0, 200));
  }

  /** Sends one message. `phone` is +998XXXXXXXXX (normalised); Eskiz wants the digits without «+». */
  async send(phone: string, message: string, from: string, callbackUrl?: string): Promise<SendResult> {
    const body: Record<string, string> = { mobile_phone: phone.replace(/\D/g, ''), message, from };
    if (callbackUrl) body.callback_url = callbackUrl;
    const json = await this.authed('/api/message/sms/send', { method: 'POST', body });
    return { id: json?.id != null ? String(json.id) : null, status: String(json?.status ?? 'waiting') };
  }

  /** Delivery status of a sent message (SMPP state name, upper case) or null when Eskiz has none yet. */
  async status(id: string): Promise<string | null> {
    const json = await this.authed(`/api/message/sms/status_by_id/${encodeURIComponent(id)}`, { method: 'GET' });
    const s = json?.data?.status ?? json?.status;
    return typeof s === 'string' && s && s !== 'success' ? s.toUpperCase() : null;
  }
}
