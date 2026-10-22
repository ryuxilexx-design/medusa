import { isUuid } from '../core/validate';
// Patient conversation engine. Transport-agnostic: the same code serves the real Telegram bot and the simulator.
// Every update runs in one transaction with the chat row locked (updates of one chat are serialised), is
// de-duplicated by update_id, and only after COMMIT are the replies sent.
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { normalizePhone } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx } from '../core/context';
import { AppError } from '../core/errors';
import { audit } from '../core/audit';
import { addDays, localDate, localTime, localToUtc, now, syncClock, today } from '../core/clock';
import { availability, cancelAppointment, createAppointment, rescheduleAppointment } from '../modules/booking';
import { PRICE_SQL } from '../modules/reference.controller';
import { recordConsent } from '../modules/consent';
import { BOT_CONSENT_VERSION, Card, humanDate, Lang, shortDate, T } from './texts';
import { InlineButton, OutMessage, ReplyMarkup, TelegramError, Transport } from './transport';
import { OWN_CARD_SQL } from './outbox';

export type Bot = { id: string; tenant_id: string; kind: 'telegram' | 'simulator' };
type State = { step?: string; v?: number; opts?: string[]; d?: Record<string, any> };
type Chat = { id: string; tenant_id: string; bot_id: string; chat_id: number; phone: string | null; lang: Lang; state: State };
type TgUser = { id: number; language_code?: string };
export type TgUpdate = {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string; contact?: { phone_number: string; user_id?: number } };
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: { id: number; type: string } } };
};

const LEAD_MIN = 30;           // earliest online booking: 30 minutes from now
const DAYS_AHEAD = 14;         // look for free days this far
const MAX_DATES = 7, MAX_TIMES = 24;
const MAX_ACTIVE_TG_BOOKINGS = 3;
const MAX_TG_PATIENTS_PER_PHONE = 6;
const NAME_RE = /^[\p{L}][\p{L}'‘’ -]{1,39}$/u;
const BOOKABLE = ['consultation', 'ultrasound', 'procedure'];

const money = (tiyin: number, lang: Lang) => `${Math.round(tiyin / 100).toLocaleString('ru-RU').replace(/ /g, ' ')} ${lang === 'uz' ? 'so‘m' : lang === 'uz-Cyrl' ? 'сўм' : 'сум'}`;
const capitalize = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** One processed update: DB client, chat, reply buffer. */
class Turn {
  out: OutMessage[] = [];
  toast: string | null = null;
  constructor(public c: PoolClient, public chat: Chat, public bot: Bot, public clinic: string, public branchIds: string[]) {}
  get t() { return T[this.chat.lang]; }
  get lang() { return this.chat.lang; }
  send(text: string, reply_markup?: ReplyMarkup) { this.out.push({ chat_id: this.chat.chat_id, text, ...(reply_markup ? { reply_markup } : {}) }); }
  /** Moves the conversation to a step; a new version makes buttons of older keyboards stale. */
  step(step: string, d: Record<string, any> = this.chat.state.d ?? {}, opts: string[] = []) {
    this.chat.state = { step, v: (this.chat.state.v ?? 0) + 1, opts, d };
    return this.chat.state.v!;
  }
  /** Inline keyboard bound to the current state version. */
  kb(rows: { text: string; key: string }[][]): ReplyMarkup {
    const v = this.chat.state.v;
    return { inline_keyboard: rows.map((r) => r.map((b): InlineButton => ({ text: b.text, callback_data: `${v}:${b.key}` }))) };
  }
  /** System actor for booking rules: registrar-level, all clinic branches, audited as «Telegram bot». */
  ctx(): Ctx {
    return { membershipId: '', userId: '', tenantId: this.chat.tenant_id, tenantName: this.clinic, role: 'registrar', name: 'Telegram bot', title: null,
      branchIds: this.branchIds, doctorId: null, doctorSpecialty: null, requestId: randomUUID(), sessionHash: '', authKind: 'system', mustChangePassword: false, locale: 'uz', textSize: 'normal' };
  }
}

const RATE_WINDOW_MS = 60_000, RATE_MAX = 30; // per chat; a public bot must not let one chat load the database

@Injectable()
export class BotEngine {
  private log = new Logger('TelegramBot');
  private rate = new Map<string, number[]>();
  constructor(private db: Db) {}

  /** Sliding-window limit per chat (in memory). Over the limit, updates are dropped silently. */
  private allowed(botId: string, chatId: number) {
    const key = `${botId}:${chatId}`, t = Date.now();
    const hits = (this.rate.get(key) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    if (hits.length >= RATE_MAX) { this.rate.set(key, hits); return false; }
    hits.push(t); this.rate.set(key, hits);
    if (this.rate.size > 10_000) for (const [k, v] of this.rate) if (!v.length || t - v[v.length - 1] > RATE_WINDOW_MS) this.rate.delete(k);
    return true;
  }

  menuKb(lang: Lang): ReplyMarkup {
    const t = T[lang];
    return { keyboard: [[{ text: t.menuBook }], [{ text: t.menuMine }, { text: t.menuAddress }], [{ text: t.menuLang }]], resize_keyboard: true, is_persistent: true };
  }
  contactKb(lang: Lang): ReplyMarkup {
    return { keyboard: [[{ text: T[lang].shareContact, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  }

  /** Processes one update. Replies are sent after the transaction commits; Telegram send errors never undo a booking. */
  async handleUpdate(bot: Bot, u: TgUpdate, transport: Transport): Promise<void> {
    const chatInfo = u.message?.chat ?? u.callback_query?.message?.chat;
    if (!chatInfo || chatInfo.type !== 'private') return; // groups and channels are ignored
    if (!this.allowed(bot.id, chatInfo.id)) { this.log.warn(`rate limit: bot ${bot.id} chat ${chatInfo.id}`); return; }
    const from = u.message?.from ?? u.callback_query?.from;
    let turn: Turn | null = null;
    try {
      await this.db.tx(async (c) => {
        const fresh = await c.query(`INSERT INTO telegram_updates (bot_id, update_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [bot.id, u.update_id]);
        if (!fresh.rowCount) return; // already processed (Telegram re-delivery)
        syncClock((await c.query('SELECT demo_now() AS n')).rows[0].n);
        const chat = await this.loadChat(c, bot, chatInfo.id, from);
        const tenant = (await c.query(`SELECT t.name, array_agg(b.id) AS branch_ids FROM tenants t JOIN branches b ON b.tenant_id = t.id WHERE t.id = $1 AND t.status = 'active' GROUP BY t.name`, [bot.tenant_id])).rows[0];
        if (!tenant) return;
        turn = new Turn(c, chat, bot, tenant.name, tenant.branch_ids);
        if (u.callback_query) await this.onCallback(turn, u.callback_query.data ?? '');
        else if (u.message) await this.onMessage(turn, u.message);
        await c.query(`UPDATE telegram_chats SET state = $2, lang = $3, updated_at = demo_now() WHERE id = $1`, [chat.id, JSON.stringify(turn.chat.state), turn.chat.lang]);
      });
    } catch (e: any) {
      this.log.error(`update ${u.update_id} (bot ${bot.id}): ${e?.stack || e}`);
      const lang: Lang = (turn as Turn | null)?.lang ?? (from?.language_code === 'ru' ? 'ru' : 'uz');
      turn = null;
      await this.deliver(bot, transport, [{ chat_id: chatInfo.id, text: T[lang].error }]);
    }
    const done = turn as Turn | null;
    if (u.callback_query) await transport.call('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: done?.toast ?? undefined, _chat_id: chatInfo.id }).catch(() => undefined);
    if (done) await this.deliver(bot, transport, done.out);
  }

  /** Sends messages; a 403 (user blocked the bot) marks the chat so no more notices are queued for it. */
  async deliver(bot: Bot, transport: Transport, msgs: OutMessage[]) {
    for (const m of msgs) {
      try { await transport.call('sendMessage', m as any); }
      catch (e) {
        if (e instanceof TelegramError && e.code === 403) { await this.db.rows(`UPDATE telegram_chats SET blocked = true WHERE bot_id = $1 AND chat_id = $2`, [bot.id, m.chat_id]); return; }
        this.log.warn(`sendMessage failed (bot ${bot.id}): ${(e as Error).message}`);
      }
    }
  }

  private async loadChat(c: PoolClient, bot: Bot, chatId: number, from?: TgUser): Promise<Chat> {
    const lang: Lang = from?.language_code === 'ru' ? 'ru' : 'uz';
    await c.query(`INSERT INTO telegram_chats (tenant_id, bot_id, chat_id, tg_user_id, lang) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (bot_id, chat_id) DO NOTHING`,
      [bot.tenant_id, bot.id, chatId, from?.id ?? null, lang]);
    const r = (await c.query(`SELECT id, tenant_id, bot_id, chat_id, phone, lang, state FROM telegram_chats WHERE bot_id = $1 AND chat_id = $2 FOR UPDATE`, [bot.id, chatId])).rows[0];
    // a user who writes again has evidently unblocked the bot
    await c.query(`UPDATE telegram_chats SET blocked = false WHERE id = $1 AND blocked`, [r.id]);
    return { ...r, chat_id: Number(r.chat_id), state: r.state ?? {} };
  }

  // ---------------------------------------------------------------- messages

  private async onMessage(t: Turn, msg: NonNullable<TgUpdate['message']>) {
    if (msg.contact) return this.onContact(t, msg.contact, msg.from);
    const text = (msg.text ?? '').trim();
    if (text.startsWith('/start')) {
      t.step('menu', {});
      if (!t.chat.phone) return t.send(t.t.welcome(t.clinic), this.contactKb(t.lang));
      return this.showMenu(t);
    }
    if (!t.chat.phone) return t.send(t.t.needContact, this.contactKb(t.lang));
    const isLabel = (k: 'menuBook' | 'menuMine' | 'menuAddress' | 'menuLang') => text === T.uz[k] || text === T['uz-Cyrl'][k] || text === T.ru[k];
    if (isLabel('menuBook')) return this.startBooking(t);
    if (isLabel('menuMine')) return this.showMine(t);
    if (isLabel('menuAddress')) return this.showAddresses(t);
    if (isLabel('menuLang')) return t.send(T.uz.langPick, { inline_keyboard: [[{ text: 'O‘zbekcha', callback_data: 'lang:uz' }, { text: 'Ўзбекча', callback_data: 'lang:uz-Cyrl' }, { text: 'Русский', callback_data: 'lang:ru' }]] });
    if (text === '/menu' || text === '/help') return this.showMenu(t);

    const step = t.chat.state.step;
    if (step === 'reg_last' || step === 'reg_first') {
      if (!NAME_RE.test(text)) return t.send(t.t.regNameBad);
      const d = { ...t.chat.state.d, [step === 'reg_last' ? 'last' : 'first']: capitalize(text) };
      if (step === 'reg_last') { t.step('reg_first', d); return t.send(t.t.regFirst); }
      t.step('reg_birth', d); return t.send(t.t.regBirth);
    }
    if (step === 'reg_birth') {
      const m = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
      const valid = !!m && !Number.isNaN(Date.parse(iso + 'T00:00:00Z')) && new Date(iso + 'T00:00:00Z').getUTCDate() === Number(m[1]) && iso >= '1900-01-01' && iso <= today();
      if (!valid) return t.send(t.t.regBirthBad);
      return this.finishRegistration(t, iso);
    }
    if (step === 'intake_1' || step === 'intake_2' || step === 'intake_3') {
      if (text.length > 1000) return t.send(t.t.intakeTooLong);
      return this.intakeAnswer(t, text);
    }
    if (step && step !== 'menu') return t.send(t.t.useButtons);
    return t.send(t.t.unknown, this.menuKb(t.lang));
  }

  private async onContact(t: Turn, contact: { phone_number: string; user_id?: number }, from?: TgUser) {
    // Only the owner's own contact proves the phone number (Telegram verified it); a forwarded contact does not.
    if (!from || contact.user_id !== from.id) return t.send(t.t.contactNotOwn, this.contactKb(t.lang));
    const phone = normalizePhone(contact.phone_number);
    if (!phone) return t.send(t.t.onlyUz, { remove_keyboard: true });
    await t.c.query(`UPDATE telegram_chats SET phone = $2, tg_user_id = $3, linked_at = demo_now() WHERE id = $1`, [t.chat.id, phone, from.id]);
    t.chat.phone = phone;
    const patients = await this.patients(t);
    t.send(patients.length ? t.t.linkedFound(patients.map((p) => `${p.last_name} ${p.first_name}`).join(', ')) : t.t.linkedNew);
    return this.showMenu(t);
  }

  private showMenu(t: Turn) {
    t.step('menu', {});
    t.send(t.t.menu, this.menuKb(t.lang));
  }

  private async showAddresses(t: Turn) {
    const rows = (await t.c.query(`SELECT name, address FROM branches WHERE tenant_id = $1 ORDER BY code`, [t.chat.tenant_id])).rows;
    t.send(t.t.addresses(rows.map((b) => `🏥 ${b.name}${b.address ? '\n' + b.address : ''}`).join('\n\n')), this.menuKb(t.lang));
  }

  // ---------------------------------------------------------------- callbacks

  private async onCallback(t: Turn, data: string) {
    if (!t.chat.phone) return t.send(t.t.needContact, this.contactKb(t.lang));
    if (data === 'lang:uz' || data === 'lang:uz-Cyrl' || data === 'lang:ru') {
      t.chat.lang = data.slice(5) as Lang;
      t.send(t.t.langSet);
      return this.showMenu(t);
    }
    if (data.startsWith('a:')) return this.onAppointmentAction(t, data);
    const [v, key] = [data.slice(0, data.indexOf(':')), data.slice(data.indexOf(':') + 1)];
    if (Number(v) !== t.chat.state.v) { t.toast = t.t.stale; return; }
    const st = t.chat.state, d = { ...(st.d ?? {}) };
    if (key === 'cancel') { t.send(t.t.flowCancelled); return this.showMenu(t); }
    const pick = () => { const i = Number(key); return Number.isInteger(i) && st.opts && i >= 0 && i < st.opts.length ? st.opts[i] : null; };

    switch (st.step) {
      case 'pick_patient': {
        const id = pick(); if (!id) return;
        if (id === 'new') { t.step('reg_last', { after: 'book' }); return t.send(t.t.regLast); }
        return this.renderServices(t, { patient_id: id });
      }
      case 'pick_service': {
        if (key === 'back') return this.startBooking(t);
        const id = pick(); if (!id) return;
        return this.renderDoctors(t, { ...d, service_id: id });
      }
      case 'pick_doctor': {
        if (key === 'back') return this.renderServices(t, { patient_id: d.patient_id });
        const id = pick(); if (!id) return;
        return this.renderDates(t, { ...d, doctor_id: id }, 'pick_date');
      }
      case 'pick_date': case 'resched_date': {
        if (key === 'back') return st.step === 'pick_date' ? this.renderDoctors(t, { patient_id: d.patient_id, service_id: d.service_id }) : this.showMenu(t);
        const date = pick(); if (!date) return;
        return this.renderTimes(t, { ...d, date }, st.step === 'pick_date' ? 'pick_time' : 'resched_time');
      }
      case 'pick_time': case 'resched_time': {
        const back = st.step === 'pick_time' ? 'pick_date' : 'resched_date';
        if (key === 'back') return this.renderDates(t, { ...d, date: undefined }, back);
        const time = pick(); if (!time) return;
        return this.renderConfirm(t, { ...d, time }, st.step === 'pick_time' ? 'confirm' : 'resched_confirm');
      }
      case 'confirm': case 'resched_confirm': {
        if (key === 'back') return this.renderTimes(t, { ...d, time: undefined }, st.step === 'confirm' ? 'pick_time' : 'resched_time');
        if (key !== 'ok') return;
        return st.step === 'confirm' ? this.book(t, d) : this.reschedule(t, d);
      }
      case 'reg_consent':
        if (key === 'yes') return this.createFromBot(t, d);
        if (key === 'no') { t.send(t.t.consentDeclined); return this.showMenu(t); }
        return;
      case 'intake_offer':
        if (key === 'ok') return this.startIntake(t, d.appointment_id);
        return this.showMenu(t);
      case 'intake_2': case 'intake_3':
        if (key === 'none') return this.intakeAnswer(t, null);
        return;
      default:
        t.toast = t.t.stale;
    }
  }

  /** Buttons on reminders and on «My appointments» carry the appointment id; ownership is re-checked every time. */
  private async onAppointmentAction(t: Turn, data: string) {
    const [, act, id] = data.split(':');
    const a = await this.ownAppointment(t, id);
    if (!a || a.status !== 'scheduled' || new Date(a.starts_at) <= now()) { t.send(t.t.notFound); return; }
    const card = await this.card(t, id);
    if (act === 'ok') {
      await t.c.query(`UPDATE appointments SET patient_confirmed_at = demo_now() WHERE id = $1 AND patient_confirmed_at IS NULL`, [id]);
      t.toast = t.t.willCome;
      return t.send(t.t.willCome);
    }
    if (act === 'cx') {
      t.step('menu', {});
      return t.send(t.t.cancelAsk(card), { inline_keyboard: [[{ text: t.t.btnCancelYes, callback_data: `a:cy:${id}` }, { text: t.t.btnNo, callback_data: `${t.chat.state.v}:cancel` }]] });
    }
    if (act === 'cy') {
      const r = await this.guarded(t, () => cancelAppointment(t.c, t.ctx(), id, { reason: 'Bemor Telegram orqali bekor qildi' }, true));
      t.send(r.ok ? t.t.cancelled : t.t.notFound, this.menuKb(t.lang));
      return;
    }
    if (act === 'rs') {
      const dur = Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000);
      return this.renderDates(t, { appointment_id: id, patient_id: a.patient_id, doctor_id: a.doctor_id, service_id: a.service_id, duration: dur }, 'resched_date');
    }
    if (act === 'in') return this.startIntake(t, id);
  }

  // ---------------------------------------------------------------- booking flow

  private async patients(t: Turn) {
    // own cards and family cards (a child's card with this number as the contact phone)
    return (await t.c.query(`SELECT p.id, p.last_name, p.first_name FROM patients p WHERE p.tenant_id = $1 AND ${OWN_CARD_SQL('$2')} ORDER BY p.created_at, p.patient_number LIMIT 10`,
      [t.chat.tenant_id, t.chat.phone])).rows;
  }

  private async ownAppointment(t: Turn, id: string | undefined) {
    if (!id || !isUuid(id)) return null;
    return (await t.c.query(
      `SELECT a.* FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE a.id = $1 AND a.tenant_id = $2 AND ${OWN_CARD_SQL('$3')}`, [id, t.chat.tenant_id, t.chat.phone])).rows[0] ?? null;
  }

  private async startBooking(t: Turn) {
    const ps = await this.patients(t);
    if (!ps.length) { t.step('reg_last', { after: 'book' }); return t.send(t.t.regLast); }
    if (ps.length === 1) return this.renderServices(t, { patient_id: ps[0].id });
    t.step('pick_patient', {}, [...ps.map((p) => p.id), 'new']);
    t.send(t.t.pickPatient, t.kb([...ps.map((p, i) => [{ text: `${p.last_name} ${p.first_name}`, key: String(i) }]), [{ text: t.t.newPerson, key: String(ps.length) }]]));
  }

  private async sameCard(t: Turn, d: Record<string, any>): Promise<string | undefined> {
    return (await t.c.query(
      `SELECT id FROM patients WHERE tenant_id = $1 AND phone = $2 AND lower(last_name) = lower($3) AND lower(first_name) = lower($4) AND birth_date = $5`,
      [t.chat.tenant_id, t.chat.phone, d.last, d.first, d.birth])).rows[0]?.id;
  }

  private async overCardLimit(t: Turn) {
    const n = (await t.c.query(`SELECT count(*)::int AS n FROM patients WHERE tenant_id = $1 AND phone = $2 AND source = 'telegram'`, [t.chat.tenant_id, t.chat.phone])).rows[0].n;
    return n >= MAX_TG_PATIENTS_PER_PHONE;
  }

  private async finishRegistration(t: Turn, birth: string) {
    const d = { ...(t.chat.state.d ?? {}), birth };
    const same = await this.sameCard(t, d);
    if (same) return this.registered(t, d, same); // an existing card: no new data is stored, consent is not asked here
    if (await this.overCardLimit(t)) { t.send(t.t.regLimit); return this.showMenu(t); }
    // A new card needs the patient's consent first (ZRU-547); nothing is stored until they press «Roziman».
    t.step('reg_consent', d);
    t.send(t.t.consentAsk(t.clinic), t.kb([[{ text: t.t.consentYes, key: 'yes' }, { text: t.t.consentNo, key: 'no' }]]));
  }

  /** «Roziman»: the card and both consents (data processing + Telegram notices) are written in this update's transaction. */
  private async createFromBot(t: Turn, d: Record<string, any>) {
    if (!d.last || !d.first || !d.birth) { t.toast = t.t.stale; return this.showMenu(t); }
    const same = await this.sameCard(t, d); // the same person may have been registered meanwhile
    if (same) return this.registered(t, d, same);
    if (await this.overCardLimit(t)) { t.send(t.t.regLimit); return this.showMenu(t); }
    const seq = (await t.c.query(`UPDATE tenants SET patient_seq = patient_seq + 1 WHERE id = $1 RETURNING patient_seq`, [t.chat.tenant_id])).rows[0].patient_seq;
    const row = (await t.c.query(
      `INSERT INTO patients (id, tenant_id, patient_number, last_name, first_name, birth_date, sex, phone, source)
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,'unspecified',$6,'telegram') RETURNING id, patient_number`,
      [t.chat.tenant_id, seq, d.last, d.first, d.birth, t.chat.phone])).rows[0];
    const ctx = t.ctx();
    await audit(t.c, ctx, 'patient.create', 'patient', row.id, `Bemor #${row.patient_number} yaratildi (Telegram)`);
    for (const kind of ['data_processing', 'notifications'] as const) {
      await recordConsent(t.c, ctx, row.id, { kind, granted: true, method: 'telegram', textVersion: BOT_CONSENT_VERSION });
    }
    return this.registered(t, d, row.id);
  }

  private registered(t: Turn, d: Record<string, any>, id: string) {
    t.send(t.t.regDone(`${d.last} ${d.first}`), this.menuKb(t.lang));
    return this.renderServices(t, { patient_id: id });
  }

  private async renderServices(t: Turn, d: Record<string, any>) {
    const rows = (await t.c.query(
      `SELECT s.id, s.name, ${PRICE_SQL.replace('$BRANCH', 'NULL')} AS price FROM services s
        WHERE s.tenant_id = $1 AND s.active AND s.category = ANY($2)
          AND EXISTS (SELECT 1 FROM doctor_services ds JOIN doctors dr ON dr.id = ds.doctor_id
                       WHERE ds.service_id = s.id AND dr.active AND EXISTS (SELECT 1 FROM schedules sc WHERE sc.doctor_id = dr.id))
        ORDER BY array_position($2, s.category), s.name LIMIT 30`, [t.chat.tenant_id, BOOKABLE])).rows;
    if (!rows.length) { t.send(t.t.noServices); return this.showMenu(t); }
    t.step('pick_service', d, rows.map((r) => r.id));
    t.send(t.t.pickService, t.kb([...rows.map((r, i) => [{ text: r.price != null ? `${r.name} · ${money(Number(r.price), t.lang)}` : r.name, key: String(i) }]), [{ text: t.t.btnCancel, key: 'cancel' }]]));
  }

  private async renderDoctors(t: Turn, d: Record<string, any>) {
    const svc = (await t.c.query(`SELECT name FROM services WHERE id = $1 AND tenant_id = $2`, [d.service_id, t.chat.tenant_id])).rows[0];
    const rows = (await t.c.query(
      `SELECT dr.id, dr.display_name, dr.specialty FROM doctors dr JOIN doctor_services ds ON ds.doctor_id = dr.id
        WHERE ds.service_id = $1 AND dr.tenant_id = $2 AND dr.active AND EXISTS (SELECT 1 FROM schedules sc WHERE sc.doctor_id = dr.id)
        ORDER BY dr.display_name`, [d.service_id, t.chat.tenant_id])).rows;
    if (!svc || !rows.length) return this.renderServices(t, { patient_id: d.patient_id });
    t.step('pick_doctor', d, rows.map((r) => r.id));
    t.send(t.t.pickDoctor(svc.name), t.kb([...rows.map((r, i) => [{ text: `${r.display_name} · ${r.specialty}`, key: String(i) }]), [{ text: t.t.btnBack, key: 'back' }, { text: t.t.btnCancel, key: 'cancel' }]]));
  }

  private async duration(t: Turn, d: Record<string, any>) {
    if (d.duration) return Number(d.duration);
    return (await t.c.query(`SELECT duration_min FROM services WHERE id = $1 AND tenant_id = $2`, [d.service_id, t.chat.tenant_id])).rows[0]?.duration_min ?? 30;
  }

  /** Bookable start times on a date: free, and at least LEAD_MIN minutes from now. */
  private async freeTimes(t: Turn, d: Record<string, any>, date: string) {
    const av = await availability(t.c, t.chat.tenant_id, d.doctor_id, date, await this.duration(t, d), d.appointment_id ?? null);
    if (!av.working) return { times: [] as string[], branch_id: null as string | null };
    const earliest = now().getTime() + LEAD_MIN * 60_000;
    const slots = av.slots as { time: string; free: boolean }[];
    return { times: slots.filter((s) => s.free && localToUtc(date, s.time).getTime() >= earliest).map((s) => s.time), branch_id: av.branch_id as string };
  }

  private async renderDates(t: Turn, d: Record<string, any>, step: 'pick_date' | 'resched_date') {
    const doc = (await t.c.query(`SELECT display_name FROM doctors WHERE id = $1 AND tenant_id = $2 AND active`, [d.doctor_id, t.chat.tenant_id])).rows[0];
    if (!doc) { t.send(t.t.notFound); return this.showMenu(t); }
    const dates: string[] = [];
    for (let i = 0; i < DAYS_AHEAD && dates.length < MAX_DATES; i++) {
      const date = addDays(today(), i);
      if ((await this.freeTimes(t, d, date)).times.length) dates.push(date);
    }
    if (!dates.length) {
      t.send(t.t.noDates);
      return step === 'pick_date' ? this.renderDoctors(t, { patient_id: d.patient_id, service_id: d.service_id }) : this.showMenu(t);
    }
    t.step(step, d, dates);
    const rows: { text: string; key: string }[][] = [];
    for (let i = 0; i < dates.length; i += 2) rows.push(dates.slice(i, i + 2).map((x, j) => ({ text: shortDate(x, t.lang), key: String(i + j) })));
    t.send(t.t.pickDate(doc.display_name), t.kb([...rows, [{ text: t.t.btnBack, key: 'back' }, { text: t.t.btnCancel, key: 'cancel' }]]));
  }

  private async renderTimes(t: Turn, d: Record<string, any>, step: 'pick_time' | 'resched_time', note?: string) {
    const { times }: { times: string[] } = await this.freeTimes(t, d, d.date);
    if (!times.length) return this.renderDates(t, { ...d, date: undefined }, step === 'pick_time' ? 'pick_date' : 'resched_date');
    const shown = times.slice(0, MAX_TIMES);
    t.step(step, d, shown);
    const rows: { text: string; key: string }[][] = [];
    for (let i = 0; i < shown.length; i += 4) rows.push(shown.slice(i, i + 4).map((x, j) => ({ text: x, key: String(i + j) })));
    t.send(note ?? t.t.pickTime(humanDate(d.date, t.lang)), t.kb([...rows, [{ text: t.t.btnBack, key: 'back' }, { text: t.t.btnCancel, key: 'cancel' }]]));
  }

  private async renderConfirm(t: Turn, d: Record<string, any>, step: 'confirm' | 'resched_confirm') {
    const { times, branch_id } = await this.freeTimes(t, d, d.date);
    if (!times.includes(d.time)) return this.renderTimes(t, { ...d, time: undefined }, step === 'confirm' ? 'pick_time' : 'resched_time', t.t.slotTaken);
    const card = await this.draftCard(t, { ...d, branch_id });
    t.step(step, { ...d, branch_id });
    t.send(t.t.confirm(card), t.kb([[{ text: t.t.btnConfirm, key: 'ok' }], [{ text: t.t.btnBack, key: 'back' }, { text: t.t.btnCancel, key: 'cancel' }]]));
  }

  /** Runs a booking mutation inside a savepoint: a rule violation or a lost race rolls back only this attempt. */
  private async guarded<R>(t: Turn, fn: () => Promise<R>): Promise<{ ok: true; value: R } | { ok: false; code: string }> {
    await t.c.query('SAVEPOINT tg_booking');
    try {
      const value = await fn();
      await t.c.query('RELEASE SAVEPOINT tg_booking');
      return { ok: true, value };
    } catch (e: any) {
      await t.c.query('ROLLBACK TO SAVEPOINT tg_booking');
      if (e instanceof AppError) return { ok: false, code: e.code };
      if (e?.code === '23P01') return { ok: false, code: 'SLOT_TAKEN' };
      throw e;
    }
  }

  private async book(t: Turn, d: Record<string, any>) {
    const active = (await t.c.query(`SELECT count(*)::int AS n FROM appointments WHERE patient_id = $1 AND source = 'telegram' AND status = 'scheduled' AND starts_at > $2`,
      [d.patient_id, now()])).rows[0].n;
    if (active >= MAX_ACTIVE_TG_BOOKINGS) { t.send(t.t.bookLimit); return this.showMenu(t); }
    const r = await this.guarded(t, () => createAppointment(t.c, t.ctx(),
      { patient_id: d.patient_id, branch_id: d.branch_id, doctor_id: d.doctor_id, service_id: d.service_id, date: d.date, start_time: d.time },
      `tg:${t.chat.id}:${t.chat.state.v}`, 'telegram'));
    if (!r.ok) return this.renderTimes(t, { ...d, time: undefined }, 'pick_time', t.t.slotTaken);
    t.send(t.t.booked(await this.card(t, r.value.id)), this.menuKb(t.lang));
    t.step('intake_offer', { appointment_id: r.value.id });
    t.send(t.t.intakeOffer, t.kb([[{ text: t.t.intakeYes, key: 'ok' }, { text: t.t.intakeLater, key: 'no' }]]));
  }

  private async reschedule(t: Turn, d: Record<string, any>) {
    const a = await this.ownAppointment(t, d.appointment_id);
    if (!a || a.status !== 'scheduled') { t.send(t.t.notFound); return this.showMenu(t); }
    const r = await this.guarded(t, () => rescheduleAppointment(t.c, t.ctx(), a.id, { version: a.version, date: d.date, start_time: d.time }, true));
    if (!r.ok) return this.renderTimes(t, { ...d, time: undefined }, 'resched_time', t.t.slotTaken);
    t.send(t.t.rescheduled(await this.card(t, a.id)), this.menuKb(t.lang));
    t.step('menu', {});
  }

  private async showMine(t: Turn) {
    t.step('menu', {});
    const rows = (await t.c.query(
      `SELECT a.id, a.status, a.patient_confirmed_at FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE a.tenant_id = $1 AND ${OWN_CARD_SQL('$2')} AND a.status IN ('scheduled','arrived') AND a.starts_at >= $3
        ORDER BY a.starts_at LIMIT 5`, [t.chat.tenant_id, t.chat.phone, now()])).rows;
    if (!rows.length) return t.send(t.t.mineNone, this.menuKb(t.lang));
    for (const a of rows) {
      const buttons = a.status === 'scheduled'
        ? { inline_keyboard: [[{ text: t.t.btnReschedule, callback_data: `a:rs:${a.id}` }, { text: t.t.btnCancelAppt, callback_data: `a:cx:${a.id}` }], [{ text: t.t.btnIntake, callback_data: `a:in:${a.id}` }]] }
        : undefined;
      t.send(t.t.mineItem(await this.card(t, a.id), !!a.patient_confirmed_at), buttons);
    }
  }

  // ---------------------------------------------------------------- pre-visit questionnaire

  private async startIntake(t: Turn, appointmentId: string) {
    const a = await this.ownAppointment(t, appointmentId);
    if (!a || a.status !== 'scheduled' || new Date(a.starts_at) <= now()) { t.send(t.t.intakeClosed); return this.showMenu(t); }
    t.step('intake_1', { appointment_id: a.id });
    t.send(t.t.intake1);
  }

  private async intakeAnswer(t: Turn, text: string | null) {
    const st = t.chat.state.step, d = { ...(t.chat.state.d ?? {}) };
    if (st === 'intake_1') {
      if (!text) return t.send(t.t.intake1);
      d.complaints = text;
      t.step('intake_2', d);
      return t.send(t.t.intake2, t.kb([[{ text: t.t.intakeNone, key: 'none' }]]));
    }
    if (st === 'intake_2') {
      d.allergies = text ? text.slice(0, 500) : null;
      t.step('intake_3', d);
      return t.send(t.t.intake3, t.kb([[{ text: t.t.intakeNoMeds, key: 'none' }]]));
    }
    const a = await this.ownAppointment(t, d.appointment_id);
    if (!a || a.status !== 'scheduled') { t.send(t.t.intakeClosed); return this.showMenu(t); }
    await t.c.query(
      `INSERT INTO intake_forms (appointment_id, tenant_id, patient_id, complaints, allergies, medications) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (appointment_id) DO UPDATE SET complaints = EXCLUDED.complaints, allergies = EXCLUDED.allergies, medications = EXCLUDED.medications, submitted_at = demo_now()`,
      [a.id, t.chat.tenant_id, a.patient_id, d.complaints, d.allergies ?? null, text ? text.slice(0, 500) : null]);
    t.send(t.t.intakeDone, this.menuKb(t.lang));
    t.step('menu', {});
  }

  // ---------------------------------------------------------------- cards

  private place(row: { branch_name: string; room_name?: string | null; address?: string | null }) {
    return `${row.branch_name}${row.room_name ? ', ' + row.room_name : ''}${row.address ? '\n' + row.address : ''}`;
  }

  private card(t: Turn, appointmentId: string): Promise<Card> {
    return cardFor(t.c, t.chat.tenant_id, appointmentId, t.lang);
  }

  private async draftCard(t: Turn, d: Record<string, any>): Promise<Card> {
    const r = (await t.c.query(
      `SELECT p.last_name || ' ' || p.first_name AS patient, s.name AS service, dr.display_name AS doctor, b.name AS branch_name, b.address,
              (SELECT r.name FROM schedules sc JOIN rooms r ON r.id = sc.room_id WHERE sc.doctor_id = dr.id AND sc.weekday = $6) AS room_name
         FROM patients p, services s, doctors dr, branches b
        WHERE p.id = $1 AND s.id = $2 AND dr.id = $3 AND b.id = $4 AND p.tenant_id = $5 AND s.tenant_id = $5 AND dr.tenant_id = $5 AND b.tenant_id = $5`,
      [d.patient_id, d.service_id, d.doctor_id, d.branch_id, t.chat.tenant_id, new Date(d.date + 'T00:00:00Z').getUTCDay()])).rows[0];
    return { patient: r.patient, service: r.service, doctor: r.doctor, date: humanDate(d.date, t.lang), time: d.time, place: this.place(r) };
  }
}

/** Appointment summary for messages (also used by the notifier). */
export async function cardFor(q: { query: PoolClient['query'] }, tenantId: string, appointmentId: string, lang: Lang): Promise<Card> {
  const r = (await q.query(
    `SELECT p.last_name || ' ' || p.first_name AS patient, s.name AS service, dr.display_name AS doctor, a.starts_at, b.name AS branch_name, b.address, rm.name AS room_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN services s ON s.id = a.service_id JOIN doctors dr ON dr.id = a.doctor_id
       JOIN branches b ON b.id = a.branch_id LEFT JOIN rooms rm ON rm.id = a.room_id
      WHERE a.id = $1 AND a.tenant_id = $2`, [appointmentId, tenantId])).rows[0];
  return {
    patient: r.patient, service: r.service, doctor: r.doctor, date: humanDate(localDate(r.starts_at), lang), time: localTime(r.starts_at),
    place: `${r.branch_name}${r.room_name ? ', ' + r.room_name : ''}${r.address ? '\n' + r.address : ''}`,
  };
}
