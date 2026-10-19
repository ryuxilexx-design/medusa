import { Pool } from 'pg';
import { config } from '../core/config';

/** A Telegram Bot API error. `code` is Telegram's error_code (403 = the user blocked the bot, 401 = bad token, 429 = rate limit). */
export class TelegramError extends Error {
  constructor(public code: number, public description: string, public retryAfter?: number) { super(`Telegram ${code}: ${description}`); }
}

export type InlineButton = { text: string; callback_data: string };
export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | { keyboard: { text: string; request_contact?: boolean }[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean; is_persistent?: boolean }
  | { remove_keyboard: true };
export type OutMessage = { chat_id: number; text: string; reply_markup?: ReplyMarkup };

export interface Transport {
  call<T = any>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

/** Real Bot API over HTTPS. The token is only ever part of the request URL — it is never logged or put in an error. */
export class HttpTransport implements Transport {
  constructor(private token: string) {}
  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.telegram.apiBase}/bot${this.token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: any) {
      throw new TelegramError(0, e?.name === 'TimeoutError' ? 'timeout' : 'network error');
    }
    const json: any = await res.json().catch(() => ({}));
    if (!json.ok) throw new TelegramError(json.error_code ?? res.status, String(json.description ?? 'error').slice(0, 300), json.parameters?.retry_after);
    return json.result as T;
  }
}

/** Simulator: writes outgoing messages to telegram_sim_messages so the staff UI and tests can read the conversation. */
export class SimTransport implements Transport {
  constructor(private pool: Pool, private botId: string) {}
  async call<T>(method: string, params: Record<string, any> = {}): Promise<T> {
    if (method === 'sendMessage') {
      const r = await this.pool.query(`INSERT INTO telegram_sim_messages (bot_id, chat_id, direction, text, markup) VALUES ($1,$2,'out',$3,$4) RETURNING id`,
        [this.botId, params.chat_id, params.text, params.reply_markup ? JSON.stringify(params.reply_markup) : null]);
      return { message_id: Number(r.rows[0].id), chat: { id: params.chat_id } } as T;
    }
    if (method === 'answerCallbackQuery') {
      if (params.text) await this.pool.query(`INSERT INTO telegram_sim_messages (bot_id, chat_id, direction, text, markup) VALUES ($1,$2,'out',$3,'{"toast":true}')`,
        [this.botId, params._chat_id, params.text]);
      return true as T;
    }
    if (method === 'getMe') return { id: 0, is_bot: true, username: 'MedUzDemoBot', first_name: 'Med.uz.ai demo' } as T;
    return true as T;
  }
}
