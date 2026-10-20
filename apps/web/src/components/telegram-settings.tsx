'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Bot, CheckCircle2, MinusCircle, Phone, RefreshCw, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, formatPhone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, cx, Field, Input, LoadingRows, ErrorState, useToast } from '@/components/ui';

type Status = {
  bot: { username: string; status: 'active' | 'disabled'; last_error: string | null; last_error_at: string | null; updated_at: string } | null;
  stats: { linked_chats: number; sent_7d: number; failed_7d: number; bookings_7d: number; confirmed_7d: number };
  secrets_configured: boolean; simulator_available: boolean; workers: boolean;
};

/** A translated sentence whose {placeholders} are rendered as elements (bold names, code). */
const rich = (s: string, parts: Record<string, React.ReactNode>) => s.split(/\{(\w+)\}/).map((x, i) => (i % 2 ? <Fragment key={i}>{parts[x]}</Fragment> : x));

/** Settings → Telegram: connect the clinic's own bot (token stored encrypted on the server) and try it in the simulator. */
export function TelegramSettings() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['telegram'], queryFn: () => api<{ data: Status }>('/telegram').then((r) => r.data), refetchInterval: 30_000 });
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const connect = useMutation({
    mutationFn: () => api<{ data: { username: string } }>('/telegram/bot', { method: 'POST', body: { token: token.trim() } }),
    onSuccess: (r) => { setToken(''); setTokenError(null); qc.invalidateQueries({ queryKey: ['telegram'] }); toast.success(t('admin.tg.connected', { bot: `@${r.data.username}` })); },
    onError: (e) => setTokenError(e instanceof ApiError && e.fields?.token ? e.fields.token : (e as Error).message),
  });
  const disconnect = useMutation({
    mutationFn: () => api('/telegram/bot', { method: 'DELETE' }),
    onSuccess: () => { setConfirmOff(false); qc.invalidateQueries({ queryKey: ['telegram'] }); toast.success(t('admin.tg.disconnected')); },
    onError: (e) => { setConfirmOff(false); toast.error(e); },
  });

  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const active = s.bot?.status === 'active';

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="min-w-0 space-y-5">
        <section>
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.tg.clinicBot')}</h3>
          <p className="mt-1 text-sm text-slate-600">{t('admin.tg.intro')}</p>
          {s.bot ? (
            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Bot className="h-5 w-5 text-slate-600" aria-hidden="true" /><span className="font-medium">@{s.bot.username}</span>
                {active ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('admin.tg.statusOn')}</Badge> : <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.tg.statusOff')}</Badge>}
                <span className="text-[0.8125rem] text-slate-600">{t('admin.tg.updatedAt', { at: fmtDateTime(s.bot.updated_at) })}</span>
                {active && !confirmOff && <Button size="sm" variant="danger" className="ml-auto" onClick={() => setConfirmOff(true)}>{t('admin.tg.turnOff')}</Button>}
              </div>
              {confirmOff && (
                <div className="mt-2"><Alert tone="yellow" title={t('admin.tg.offTitle')}>{t('admin.tg.offText')}
                  <div className="mt-2 flex gap-2"><Button size="sm" variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>{t('admin.tg.offYes')}</Button><Button size="sm" onClick={() => setConfirmOff(false)}>{t('admin.tg.no')}</Button></div>
                </Alert></div>
              )}
              {s.bot.last_error && <div className="mt-2"><Alert tone="red" title={t('admin.tg.broken')}>{s.bot.last_error}{s.bot.last_error_at ? ` (${fmtDateTime(s.bot.last_error_at)})` : ''}</Alert></div>}
            </div>
          ) : null}
          {!active && (
            <div className="mt-3 space-y-3 rounded-lg border border-dashed border-slate-300 p-3">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                <li>{rich(t('admin.tg.step1'), { botfather: <b>@BotFather</b>, newbot: <code>/newbot</code>, suffix: <code>…_bot</code> })}</li>
                <li>{t('admin.tg.step2', { botfather: 'BotFather' })}</li>
              </ol>
              {!s.secrets_configured && <Alert tone="yellow" title={t('admin.tg.noSecretsTitle')}>{rich(t('admin.tg.noSecrets'), { key: <code>APP_SECRET_KEY</code> })}</Alert>}
              <form className="flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); setTokenError(null); if (!token.trim()) { setTokenError(t('admin.tg.enterToken')); return; } connect.mutate(); }}>
                <Field label={t('admin.tg.token')} error={tokenError ?? undefined} className="flex-1">
                  {(id) => <Input id={id} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => { setToken(e.target.value); setTokenError(null); }} placeholder="123456789:AA…" disabled={!s.secrets_configured} invalid={!!tokenError} />}
                </Field>
                <Button type="submit" variant="primary" className="sm:mt-6" loading={connect.isPending} disabled={!s.secrets_configured}>{t('admin.tg.connect')}</Button>
              </form>
            </div>
          )}
          {!s.workers && (
            <div className="mt-2 text-[0.8125rem] text-amber-900">
              <p>{t('admin.tg.workersOff')}</p>
              <details className="mt-1 text-slate-600"><summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{t('admin.ai.adminDetails')}</summary>
                <p className="mt-1">{rich(t('admin.tg.adminDetails'), { setting: <code>TELEGRAM_WORKERS=off</code> })}</p></details>
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.tg.last7')}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-5">
            {[[t('admin.tg.statChats'), s.stats.linked_chats], [t('admin.tg.statBookings'), s.stats.bookings_7d], [t('admin.tg.statSent'), s.stats.sent_7d], [t('admin.tg.statConfirmed'), s.stats.confirmed_7d], [t('admin.tg.statFailed'), s.stats.failed_7d]].map(([k, v]) => (
              <div key={k as string} className="flex min-w-0 flex-col justify-between gap-1 rounded-lg border border-slate-200 px-3 py-2">
                <dt className="break-words text-[0.8125rem] leading-snug text-slate-600">{k}</dt><dd className="text-xl font-semibold tabular-nums text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-[0.8125rem] text-slate-600">{t('admin.tg.statsNote')}</p>
        </section>

        <section className="text-sm text-slate-600">
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.tg.how')}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>{t('admin.tg.how1')}</li>
            <li>{t('admin.tg.how2', { tg: 'TG' })}</li>
            <li>{t('admin.tg.how3')}</li>
          </ul>
        </section>
      </div>
      {s.simulator_available && <Simulator />}
    </div>
  );
}

type SimMsg = { id: number; direction: 'in' | 'out'; text: string; markup: any };
const CHAT_KEY = 'meduza.tgsim.chat';

/** Phone-like chat that drives the real bot engine through the server (demo mode only). */
function Simulator() {
  const t = useT();
  const { me } = useSession();
  const toast = useToast();
  const [chatId, setChatId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<SimMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  async function newChat() {
    const r = await api<{ data: { chat_id: number } }>('/telegram/sim/chats', { method: 'POST' });
    try { localStorage.setItem(`${CHAT_KEY}.${me.membership_id}`, String(r.data.chat_id)); } catch { /* ignore */ }
    last.current = 0; setMsgs([]); setContactOpen(false); setChatId(r.data.chat_id);
  }
  useEffect(() => {
    let saved: number | null = null;
    try { saved = Number(localStorage.getItem(`${CHAT_KEY}.${me.membership_id}`)) || null; } catch { /* ignore */ }
    if (saved && saved < 0) setChatId(saved); else void newChat().catch((e) => toast.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pulling = useRef<Promise<void> | null>(null);
  /** One fetch at a time (polling and sending both pull); messages are merged by id, never appended twice. */
  function pull(): Promise<void> {
    if (!chatId) return Promise.resolve();
    if (pulling.current) return pulling.current.then(() => pull());
    const run = (async () => {
      const r = await api<{ data: SimMsg[] }>(`/telegram/sim/messages?chat_id=${chatId}&after=${last.current}`);
      if (!r.data.length) return;
      last.current = Math.max(last.current, r.data[r.data.length - 1].id);
      setMsgs((m) => { const seen = new Set(m.map((x) => x.id)); return [...m, ...r.data.filter((x) => !seen.has(x.id))]; });
    })().finally(() => { pulling.current = null; });
    pulling.current = run;
    return run;
  }
  useEffect(() => {
    if (!chatId) return;
    void pull();
    const i = setInterval(() => { void pull().catch(() => undefined); }, 2_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs.length]);

  async function send(body: Record<string, unknown>) {
    if (!chatId || busy) return;
    setBusy(true);
    try { await api('/telegram/sim/send', { method: 'POST', body: { chat_id: chatId, ...body } }); await pull(); }
    catch (e) { toast.error(e); }
    finally { setBusy(false); }
  }
  const runWorkers = useMutation({
    mutationFn: () => api<{ data: { planned: number; sent: number; skipped: number; failed: number } }>('/telegram/sim/run-workers', { method: 'POST' }),
    onSuccess: async (r) => { await pull(); toast.info(t('admin.tg.remindersToast', { planned: r.data.planned, sent: r.data.sent })); },
    onError: (e) => toast.error(e),
  });
  async function demoPhone() {
    const r = await api<{ data: any[] }>('/patients?page_size=50');
    const p = r.data.filter((x) => x.phone)[Math.floor(Math.random() * Math.min(50, r.data.length))] ?? r.data.find((x) => x.phone);
    if (p?.phone) setPhone(formatPhone(p.phone));
  }

  // current reply keyboard = the latest keyboard sent, unless removed afterwards
  let replyKb: { text: string; request_contact?: boolean }[][] | null = null;
  for (const m of msgs) if (m.direction === 'out' && m.markup) { if (m.markup.keyboard) replyKb = m.markup.keyboard; else if (m.markup.remove_keyboard) replyKb = null; }

  return (
    <section aria-label={t('admin.tg.simAria')} className="min-w-0 self-start xl:sticky xl:top-24">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="whitespace-nowrap text-sm font-semibold text-slate-900">{t('admin.tg.simTitle')} <span className="font-normal text-slate-600">· {t('admin.tg.simDemo')}</span></h3>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" icon={<BellRing className="h-4 w-4" />} loading={runWorkers.isPending} onClick={() => runWorkers.mutate()} title={t('admin.tg.remindersTitle')}>{t('admin.tg.reminders')}</Button>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void newChat().catch((e) => toast.error(e))}>{t('admin.tg.newChat')}</Button>
        </div>
      </div>
      <div className="flex h-[min(38rem,calc(100dvh-10rem))] min-h-[24rem] flex-col overflow-hidden rounded-[1.375rem] border-4 border-slate-800 bg-[#dfe7ee] shadow-lg">
        <div className="flex items-center gap-2 bg-[#517da2] px-3 py-2 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20"><Bot className="h-4 w-4" /></div>
          <div className="min-w-0 leading-tight"><div className="truncate text-sm font-semibold">{me.clinic_name}</div><div className="text-xs text-white/90">{t('admin.tg.simHeader')}</div></div>
        </div>
        <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-2 py-3" aria-live="polite">
          {!msgs.length && <p className="mt-16 text-center text-[0.8125rem] text-slate-700">{rich(t('admin.tg.simStart'), { cmd: <b>/start</b> })}</p>}
          {msgs.map((m) => m.markup?.toast ? (
            <div key={m.id} className="text-center"><span className="rounded-full bg-slate-700/80 px-2 py-0.5 text-xs text-white">{m.text}</span></div>
          ) : (
            <div key={m.id} className={cx('flex flex-col', m.direction === 'in' ? 'items-end' : 'items-start')}>
              <div className={cx('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[0.8125rem] leading-snug shadow-sm', m.direction === 'in' ? 'rounded-br-sm bg-[#effdde] text-slate-900' : 'rounded-bl-sm bg-white text-slate-900')}>{m.text}</div>
              {m.markup?.inline_keyboard && (
                <div className="mt-1 flex w-[85%] flex-col gap-1">
                  {m.markup.inline_keyboard.map((row: any[], i: number) => (
                    <div key={i} className="flex gap-1">
                      {row.map((b) => <button key={b.callback_data} type="button" disabled={busy} onClick={() => send({ callback_data: b.callback_data, label: b.text })}
                        className="min-h-9 min-w-0 flex-1 truncate rounded-md bg-white/80 px-2 py-1.5 text-[0.8125rem] font-medium text-[#2f5f8a] shadow-sm hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:opacity-60">{b.text}</button>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {contactOpen && (
          <form className="flex flex-wrap items-center gap-2 border-t border-slate-300 bg-white px-2 py-2" onSubmit={(e) => { e.preventDefault(); if (!phone.trim()) return; setContactOpen(false); void send({ contact_phone: phone.trim() }); }}>
            <Phone className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
            <Input aria-label={t('admin.tg.sharePhoneAria')} className="h-9 w-auto min-w-[10rem] flex-1 text-[0.8125rem]" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" autoFocus />
            <div className="flex gap-1">
              <Button size="sm" type="button" variant="ghost" onClick={() => void demoPhone()} aria-label={t('admin.tg.demoPhoneTitle')}>{t('admin.tg.demoPhone')}</Button>
              <Button size="sm" type="submit" variant="primary">{t('admin.tg.share')}</Button>
            </div>
          </form>
        )}
        {replyKb && !contactOpen && (
          <div className="space-y-1 border-t border-slate-300 bg-slate-100 p-1.5">
            {replyKb.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map((b) => <button key={b.text} type="button" disabled={busy} onClick={() => (b.request_contact ? setContactOpen(true) : void send({ text: b.text }))}
                  className="min-h-9 min-w-0 flex-1 truncate rounded-md bg-white px-2 py-1.5 text-[0.8125rem] text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:opacity-60">{b.text}</button>)}
              </div>
            ))}
          </div>
        )}
        <form className="flex items-center gap-2 border-t border-slate-300 bg-white px-2 py-2" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; const msg = text.trim(); setText(''); void send({ text: msg }); }}>
          <input aria-label={t('admin.tg.messageAria')} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('admin.tg.messagePlaceholder')} maxLength={2000}
            className="h-9 min-w-0 flex-1 rounded-full bg-slate-100 px-3 text-[0.8125rem] placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-amber-300" />
          <button type="submit" disabled={busy || !text.trim()} aria-label={t('admin.tg.send')} className="rounded-full p-2 text-[#2f5f8a] hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:opacity-40"><Send className="h-5 w-5" /></button>
        </form>
      </div>
      <p className="mt-2 text-[0.8125rem] text-slate-600">{t('admin.tg.simNote')}</p>
    </section>
  );
}
