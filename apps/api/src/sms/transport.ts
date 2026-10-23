// SMS delivery for the notifier: per-clinic Eskiz credentials (password encrypted at rest, decrypted only here),
// one gateway client per clinic, a delivery log without message text, and delivery-status polling.
import { Injectable, Logger } from '@nestjs/common';
import { Db, Q } from '../core/db';
import { decryptSecret, secretsConfigured } from '../core/secrets';
import { DELIVERED_STATES, EskizClient, EskizError, UNDELIVERED_STATES } from './eskiz';

export type SmsSettingsRow = { tenant_id: string; eskiz_email: string | null; password_enc: string | null; sender: string; enabled: boolean; last_error: string | null; last_error_at: Date | null; balance_checked_at: Date | null; updated_at: Date };

export const SETTINGS_COLS = 'tenant_id, eskiz_email, password_enc, sender, enabled, last_error, last_error_at, balance_checked_at, updated_at';

@Injectable()
export class SmsSender {
  private log = new Logger('Sms');
  private clients = new Map<string, EskizClient>();
  constructor(private db: Db) {}

  async settings(q: Q, tenantId: string): Promise<SmsSettingsRow | undefined> {
    return (await q.query(`SELECT ${SETTINGS_COLS} FROM sms_settings WHERE tenant_id = $1`, [tenantId])).rows[0];
  }

  /** Gateway client for a clinic; rebuilt when the credentials change. Throws when they are missing. */
  clientFor(s: Pick<SmsSettingsRow, 'tenant_id' | 'eskiz_email' | 'password_enc'>): EskizClient {
    if (!s.eskiz_email || !s.password_enc) throw new EskizError(401, 'Eskiz hisobi sozlanmagan');
    if (!secretsConfigured()) throw new EskizError(401, 'APP_SECRET_KEY sozlanmagan');
    const creds = { email: s.eskiz_email, password: decryptSecret(s.password_enc) };
    const cached = this.clients.get(s.tenant_id);
    if (cached && cached.matches(creds)) return cached;
    const c = new EskizClient(creds);
    this.clients.set(s.tenant_id, c);
    return c;
  }

  /** Checks credentials with the gateway (used when the manager saves them). */
  async verify(creds: { email: string; password: string }): Promise<void> {
    await new EskizClient(creds).login();
  }

  /**
   * Sends one message and logs it (kind, phone, provider id — never the text). A non-retryable gateway answer (4xx)
   * is logged as failed and rethrown; a retryable one (5xx, network) is only rethrown so the outbox backs off.
   */
  async send(q: Q, m: { tenantId: string; notificationId?: string | null; kind: string; phone: string; text: string; parts: number }): Promise<{ providerId: string | null }> {
    const s = await this.settings(q, m.tenantId);
    if (!s || !s.enabled) throw new EskizError(403, 'SMS kanali o‘chirilgan');
    try {
      const r = await this.clientFor(s).send(m.phone, m.text, s.sender || '4546');
      await q.query(`INSERT INTO sms_messages (tenant_id, notification_id, kind, phone, provider_id, status, parts) VALUES ($1,$2,$3,$4,$5,'sent',$6)`,
        [m.tenantId, m.notificationId ?? null, m.kind, m.phone, r.id, m.parts]);
      await q.query(`UPDATE sms_settings SET last_error = NULL WHERE tenant_id = $1 AND last_error IS NOT NULL`, [m.tenantId]);
      return { providerId: r.id };
    } catch (e) {
      const err = e instanceof EskizError ? e : new EskizError(0, String((e as Error).message).slice(0, 200));
      const msg = this.describe(err);
      await q.query(`UPDATE sms_settings SET last_error = $2, last_error_at = demo_now() WHERE tenant_id = $1`, [m.tenantId, msg]);
      if (!err.retryable) {
        await q.query(`INSERT INTO sms_messages (tenant_id, notification_id, kind, phone, status, error, parts) VALUES ($1,$2,$3,$4,'failed',$5,$6)`,
          [m.tenantId, m.notificationId ?? null, m.kind, m.phone, msg, m.parts]);
      }
      throw err;
    }
  }

  /** Staff-facing (Uzbek) description of a gateway error; the error filter translates known sentences. */
  describe(e: EskizError): string {
    if (e.status === 401 || e.status === 400 && /password|email|credential/i.test(e.detail)) return 'Eskiz login yoki parolni qabul qilmadi. Sozlamalarni tekshiring.';
    if (e.status === 0) return `Eskiz bilan aloqa yo‘q (${e.detail}).`;
    if (e.status >= 500) return `Eskiz serveri xatosi (${e.status}).`;
    if (e.status === 429) return 'Eskiz: juda ko‘p so‘rov. Birozdan keyin qayta uriniladi.';
    return `Eskiz rad etdi (${e.status}): ${e.detail}`.slice(0, 300);
  }

  /** Asks the gateway for the delivery state of recent messages (bounded; one clinic at a time, errors do not stop the others). */
  async refreshStatuses(limit = 50): Promise<number> {
    const rows = await this.db.rows<{ id: string; tenant_id: string; provider_id: string }>(
      `SELECT m.id, m.tenant_id, m.provider_id FROM sms_messages m JOIN sms_settings s ON s.tenant_id = m.tenant_id AND s.enabled
        WHERE m.status = 'sent' AND m.provider_id IS NOT NULL AND m.created_at BETWEEN demo_now() - interval '3 days' AND demo_now() - interval '1 minute'
          AND m.updated_at <= demo_now() - interval '5 minutes'
        ORDER BY m.created_at LIMIT $1`, [limit]);
    let n = 0;
    for (const r of rows) {
      try {
        const s = await this.settings(this.db.pool, r.tenant_id);
        if (!s) continue;
        const state = await this.clientFor(s).status(r.provider_id);
        const status = state && DELIVERED_STATES.has(state) ? 'delivered' : state && UNDELIVERED_STATES.has(state) ? 'undelivered' : null;
        await this.db.rows(`UPDATE sms_messages SET status = coalesce($2, status), error = CASE WHEN $2 = 'undelivered' THEN $3 ELSE error END, updated_at = demo_now() WHERE id = $1`, [r.id, status, state]);
        n++;
      } catch (e) {
        this.log.warn(`sms status ${r.id}: ${(e as Error).message}`);
        await this.db.rows(`UPDATE sms_messages SET updated_at = demo_now() WHERE id = $1`, [r.id]).catch(() => undefined);
      }
    }
    return n;
  }
}
