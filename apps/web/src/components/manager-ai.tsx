'use client';
// The manager's AI on the dashboard: «Kun xulosasi» (daily digest from SQL facts, numbers checked on the server)
// and «AI’dan so‘rash» (a question → one whitelisted report template → rows + a short answer). Nothing here is
// stored in the browser; the digest is cached on the server.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, RefreshCw, Send, ShieldAlert, Sparkles } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDate, fmtTime, formatSom, longDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useI18n, useT } from '@/lib/i18n';
import { Badge, Button, Card, cx, ErrorState, Input, Skeleton, Table, Td, Th } from '@/components/ui';

type Item = { text: string; fact_keys: string[] };
type Alert = Item & { severity: 'info' | 'warning' | 'critical' };
type Digest = {
  day: string; mode: 'live' | 'sample' | 'off'; source: 'model' | 'cache' | 'template'; digest: { bullets: Item[]; alerts: Alert[] };
  generated_at: string; dropped: number; regenerations_left: number; reason: string | null;
};

function modeBadge(d: Digest): [MessageKey, 'teal' | 'yellow' | 'gray'] {
  if (d.mode === 'sample') return ['mgrai.digest.sample', 'yellow'];
  if (d.mode === 'off') return ['mgrai.digest.off', 'gray'];
  return d.source === 'template' ? ['mgrai.digest.fallback', 'gray'] : ['mgrai.digest.live', 'teal'];
}

const SEVERITY = {
  critical: { icon: ShieldAlert, cls: 'text-red-700', box: 'border-red-200 bg-red-50/70', label: 'mgrai.digest.critical' },
  warning: { icon: AlertTriangle, cls: 'text-amber-700', box: 'border-amber-200 bg-amber-50/70', label: 'mgrai.digest.warning' },
  info: { icon: Info, cls: 'text-sky-700', box: 'border-sky-200 bg-sky-50/70', label: 'mgrai.digest.info' },
} as const;

/** Yesterday's digest for the selected branch, in the person's language (one request shared by both cards). */
function useDigest() {
  const { branchId } = useSession();
  const { locale } = useI18n();
  const key = ['ai-digest', branchId, locale];
  return { key, q: useQuery<Digest>({ queryKey: key, queryFn: () => api(`/ai/digest${qs({ branch_id: branchId })}`).then((r) => r.data), staleTime: 10 * 60_000 }) };
}

/** «Kun xulosasi»: yesterday's digest; regenerate only when the model is live. */
export function DayDigest() {
  const { branchId, me } = useSession();
  const t = useT();
  const qc = useQueryClient();
  const { key, q } = useDigest();
  const regen = useMutation({
    mutationFn: () => api('/ai/digest/regenerate', { method: 'POST', body: { date: q.data?.day, branch_id: branchId || null } }).then((r) => r.data as Digest),
    onSuccess: (d) => qc.setQueryData(key, d),
  });
  const d = q.data;
  const [badge, tone] = d ? modeBadge(d) : ['mgrai.digest.live' as MessageKey, 'gray' as const];
  const dayLabel = d && (d.day === addDays(me.today, -1) ? `${t('mgrai.digest.yesterday')}, ${longDate(d.day)}` : longDate(d.day));
  return (
    <Card
      title={<span className="flex items-center gap-2"><Sparkles className="h-5 w-5 shrink-0 text-brand-600" />{t('mgrai.digest.title')}{dayLabel && <span className="font-semibold text-slate-600">· {dayLabel}</span>}</span>}
      actions={d && <>
        <Badge tone={tone}>{t(badge)}</Badge>
        {d.mode === 'live' && (
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} loading={regen.isPending} disabled={d.regenerations_left <= 0}
            title={t('mgrai.digest.left', { n: d.regenerations_left })} onClick={() => regen.mutate()}>{t('mgrai.digest.regenerate')}</Button>
        )}
      </>}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? (
        <div className="space-y-2.5"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /></div>
      ) : (
        <>
          <div className={cx('grid grid-cols-1 gap-5', d.digest.alerts.length > 0 && 'lg:grid-cols-[3fr_2fr]')}>
            <div>
              <h3 className="mb-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-slate-600">{t('mgrai.digest.happened')}</h3>
              <ul className="space-y-1.5 text-[0.9375rem] text-slate-900">
                {d.digest.bullets.map((b, i) => <li key={i} className="flex gap-2.5"><span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" /><span>{b.text}</span></li>)}
              </ul>
            </div>
            {d.digest.alerts.length > 0 && (
              <div>
                <h3 className="mb-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-slate-600">{t('mgrai.digest.attention')}</h3>
                <ul className="space-y-2">
                  {d.digest.alerts.map((a, i) => {
                    const s = SEVERITY[a.severity] ?? SEVERITY.info;
                    const Icon = s.icon;
                    return (
                      <li key={i} className={cx('flex gap-2.5 rounded-lg border px-3 py-2 text-[0.9375rem] text-slate-900', s.box)}>
                        <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', s.cls)} aria-hidden /><span><span className="sr-only">{t(s.label)}: </span>{a.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          <p className="mt-3 text-[0.8125rem] text-slate-600">
            {t('mgrai.digest.generated', { time: `${fmtDate(d.generated_at)} ${fmtTime(d.generated_at)}` })}
            {d.dropped > 0 && ` · ${t('mgrai.digest.dropped', { n: d.dropped })}`}
            {d.reason && ` · ${d.reason}`}
          </p>
          {regen.isError && <p className="mt-2 text-sm text-red-700" role="alert">{(regen.error as Error).message}</p>}
        </>
      )}
    </Card>
  );
}

type Col = { key: string; type: 'text' | 'date' | 'month' | 'hour' | 'money' | 'count' | 'qty' | 'min' };
type AskOut =
  | { status: 'answered'; mode: string; template: string; title: string; columns: Col[]; rows: Record<string, string | number | null>[]; answer: Item[]; answer_source: 'model' | 'template' }
  | { status: 'unsupported'; reason: string; message: string; can_ask: { id: string; title: string }[] };
type AskIn = { question?: string; template?: string; params?: Record<string, unknown> };

const cell = (c: Col, v: string | number | null) => {
  if (v == null) return '—';
  if (c.type === 'money') return formatSom(Number(v));
  if (c.type === 'date') return fmtDate(String(v));
  if (c.type === 'count' || c.type === 'min' || c.type === 'qty') return Number(v).toLocaleString('ru-RU');
  return String(v);
};
const numeric = (c: Col) => c.type === 'money' || c.type === 'count' || c.type === 'qty' || c.type === 'min';

/** «AI’dan so‘rash»: a free question (live AI) or a ready example (works without AI too). */
export function AskNumbers() {
  const { branchId, me } = useSession();
  const t = useT();
  const aiLive = useDigest().q.data?.mode === 'live';
  const [text, setText] = useState('');
  const m = useMutation({ mutationFn: (b: AskIn) => api('/ai/ask', { method: 'POST', body: { ...b, branch_id: branchId || null } }).then((r) => r.data as AskOut) });
  const y = addDays(me.today, -1), week = addDays(me.today, -6);
  const examples: [MessageKey, AskIn][] = [
    ['mgrai.ex.revenueDoctors', { template: 'revenue', params: { group_by: 'doctor', from: y, to: y } }],
    ['mgrai.ex.noShow', { template: 'visits', params: { group_by: 'doctor', from: week, to: me.today } }],
    ['mgrai.ex.debts', { template: 'debts_ageing' }],
    ['mgrai.ex.expiring', { template: 'stock', params: { kind: 'expiring', days: 30 } }],
    ['mgrai.ex.expenses', { template: 'expenses', params: { from: `${me.today.slice(0, 8)}01`, to: me.today } }],
    ['mgrai.ex.flow', { template: 'patient_flow', params: { from: week, to: me.today } }],
  ];
  const r = m.data;
  return (
    <Card title={<span className="flex items-center gap-2"><Sparkles className="h-5 w-5 shrink-0 text-brand-600" />{t('mgrai.ask.title')}</span>}>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) m.mutate({ question: text.trim() }); }}>
        <label htmlFor="ask-q" className="sr-only">{t('mgrai.ask.label')}</label>
        <Input id="ask-q" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} disabled={!aiLive} placeholder={aiLive ? t('mgrai.ask.placeholder') : t('mgrai.ask.offHint')} className="min-w-0 flex-1" />
        <Button type="submit" variant="primary" icon={<Send className="h-4 w-4" />} disabled={!aiLive || text.trim().length < 3} loading={m.isPending && !!m.variables?.question}>{t('mgrai.ask.send')}</Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2" aria-label={t('clinical.dash.quickQuestions')}>
        {examples.map(([label, body]) => (
          <Button key={label} size="sm" loading={m.isPending && m.variables?.template === body.template && m.variables?.question === t(label)} onClick={() => m.mutate({ ...body, question: t(label) })}>{t(label)}</Button>
        ))}
      </div>
      {m.isError && <p className="mt-3 text-sm text-red-700" role="alert">{(m.error as Error).message}</p>}
      {r?.status === 'unsupported' && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-[0.9375rem] text-slate-900" role="status">
          <p>{r.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {r.can_ask.map((x) => <Button key={x.id} size="sm" variant="ghost" onClick={() => m.mutate({ template: x.id, question: x.title })}>{x.title}</Button>)}
          </div>
        </div>
      )}
      {r?.status === 'answered' && (
        <div className="mt-4 space-y-3" role="status">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[0.9375rem] text-slate-900">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.title}</span>
              <Badge tone={r.answer_source === 'model' ? 'teal' : 'gray'}>{t(r.answer_source === 'model' ? 'mgrai.ask.answerModel' : 'mgrai.ask.answerTemplate')}</Badge>
            </div>
            {r.answer.map((a, i) => <p key={i}>{a.text}</p>)}
          </div>
          {r.rows.length > 0 && (
            <Table className="max-h-80 rounded-lg border border-slate-200">
              <thead><tr>{r.columns.map((c) => <Th key={c.key} right={numeric(c)}>{t(`mgrai.col.${c.key}` as MessageKey)}</Th>)}</tr></thead>
              <tbody>{r.rows.map((row, i) => <tr key={i}>{r.columns.map((c) => <Td key={c.key} right={numeric(c)}>{cell(c, row[c.key])}</Td>)}</tr>)}</tbody>
            </Table>
          )}
        </div>
      )}
    </Card>
  );
}
