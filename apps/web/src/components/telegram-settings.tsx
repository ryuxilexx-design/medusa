'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Bot, Phone, RefreshCw, Send } from 'lucide-react';
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
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-5">
        <section>
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.tg.clinicBot')}</h3>
          <p className="mt-1 text-[0.8125rem] text-slate-600">{t('admin.tg.intro')}</p>
          {s.bot ? (
            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Bot className="h-4 w-4 text-slate-500" /><span className="font-medium">@{s.bot.username}</span>
                {active ? <Badge tone="green">{t('admin.tg.statusOn')}</Badge> : <Badge>{t('admin.tg.statusOff')}</Badge>}
                <span className="text-xs text-slate-600">{fmtDateTime(s.bot.updated_at)}</span>
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
              <ol className="list-decimal space-y-1 pl-5 text-[0.8125rem] text-slate-700">
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
          {!s.workers && <p className="mt-2 text-xs text-amber-800">{t('admin.tg.workersOff')}</p>}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.tg.last7')}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[[t('admin.tg.statChats'), s.stats.linked_chats], [t('admin.tg.statBookings'), s.stats.bookings_7d], [t('admin.tg.statSent'), s.stats.sent_7d], [t('admin.tg.statConfirmed'), s.stats.confirmed_7d], [t('admin.tg.statFailed'), s.stats.failed_7d]].map(([k, v]) => (
              <div key={k as string} className="rounded-md border border-slate-200 px-3 py-2"><dt className="text-2xs text-slate-600">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-1 text-xs text-slate-600">{t('admin.tg.statsNote')}</p>
        </section>

        <section className="text-[0.8125rem] text-slate-600">
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
    <section aria-label={t('admin.tg.simAria')} className="self-start xl:sticky xl:top-[72px]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{t('admin.tg.simTitle')} <span className="font-normal text-slate-600">· {t('admin.tg.simDemo')}</span></h3>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" icon={<BellRing className="h-4 w-4" />} loading={runWorkers.isPending} onClick={() => runWorkers.mutate()} title={t('admin.tg.remindersTitle')}>{t('admin.tg.reminders')}</Button>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void newChat().catch((e) => toast.error(e))}>{t('admin.tg.newChat')}</Button>
        </div>
      </div>
      <div className="flex h-[620px] flex-col overflow-hidden rounded-[22px] border-4 border-slate-800 bg-[#dfe7ee] shadow-lg">
        <div className="flex items-center gap-2 bg-[#517da2] px-3 py-2 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20"><Bot className="h-4 w-4" /></div>
          <div className="leading-tight"><div className="text-sm font-semibold">{me.clinic_name}</div><div className="text-2xs text-white/80">{t('admin.tg.simHeader')}</div></div>
        </div>
        <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-2 py-3" aria-live="polite">
          {!msgs.length && <p className="mt-16 text-center text-xs text-slate-600">{rich(t('admin.tg.simStart'), { cmd: <b>/start</b> })}</p>}
          {msgs.map((m) => m.markup?.toast ? (
            <div key={m.id} className="text-center"><span className="rounded-full bg-slate-700/70 px-2 py-0.5 text-2xs text-white">{m.text}</span></div>
          ) : (
            <div key={m.id} className={cx('flex flex-col', m.direction === 'in' ? 'items-end' : 'items-start')}>
              <div className={cx('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[0.8125rem] leading-snug shadow-sm', m.direction === 'in' ? 'rounded-br-sm bg-[#effdde] text-slate-900' : 'rounded-bl-sm bg-white text-slate-900')}>{m.text}</div>
              {m.markup?.inline_keyboard && (
                <div className="mt-1 flex w-[85%] flex-col gap-1">
                  {m.markup.inline_keyboard.map((row: any[], i: number) => (
                    <div key={i} className="flex gap-1">
                      {row.map((b) => <button key={b.callback_data} type="button" disabled={busy} onClick={() => send({ callback_data: b.callback_data, label: b.text })}
                        className="flex-1 truncate rounded-md bg-white/70 px-2 py-1.5 text-[0.75rem] font-medium text-[#3a6d99] shadow-sm hover:bg-white disabled:opacity-60">{b.text}</button>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {contactOpen && (
          <form className="flex items-center gap-2 border-t border-slate-300 bg-white px-2 py-2" onSubmit={(e) => { e.preventDefault(); if (!phone.trim()) return; setContactOpen(false); void send({ contact_phone: phone.trim() }); }}>
            <Phone className="h-4 w-4 shrink-0 text-slate-500" />
            <Input aria-label={t('admin.tg.sharePhoneAria')} className="h-8 text-[0.8125rem]" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" autoFocus />
            <Button size="sm" type="button" variant="ghost" onClick={() => void demoPhone()} title={t('admin.tg.demoPhoneTitle')}>{t('admin.tg.demoPhone')}</Button>
            <Button size="sm" type="submit" variant="primary">{t('admin.tg.share')}</Button>
          </form>
        )}
        {replyKb && !contactOpen && (
          <div className="space-y-1 border-t border-slate-300 bg-slate-100 p-1.5">
            {replyKb.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map((b) => <button key={b.text} type="button" disabled={busy} onClick={() => (b.request_contact ? setContactOpen(true) : void send({ text: b.text }))}
                  className="flex-1 truncate rounded-md bg-white px-2 py-1.5 text-[0.75rem] text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60">{b.text}</button>)}
              </div>
            ))}
          </div>
        )}
        <form className="flex items-center gap-2 border-t border-slate-300 bg-white px-2 py-2" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; const msg = text.trim(); setText(''); void send({ text: msg }); }}>
          <input aria-label={t('admin.tg.messageAria')} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('admin.tg.messagePlaceholder')} maxLength={2000}
            className="h-9 flex-1 rounded-full bg-slate-100 px-3 text-[0.8125rem] focus:outline-none focus:ring-2 focus:ring-[#517da2]" />
          <button type="submit" disabled={busy || !text.trim()} aria-label={t('admin.tg.send')} className="rounded-full p-2 text-[#517da2] hover:bg-slate-100 disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </form>
      </div>
      <p className="mt-2 text-xs text-slate-600">{t('admin.tg.simNote')}</p>
    </section>
  );
}
