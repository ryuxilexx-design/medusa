'use client';
// «Natija sharhi» — the doctor's commentary on a verified lab result (docs/AI.md). Critical values come first from the
// server; the rest is the model's wording of server facts (or a template). Never shown to the patient; nothing saved.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldAlert, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Alert, Button } from './ui';

type Commentary = {
  mode: 'live' | 'sample' | 'off'; source: 'model' | 'template'; reason: string | null;
  critical: { code: string; text: string }[]; sentences: { text: string }[];
  params: { code: string; name: string; unit: string; value: string; flag: string; previous: { date: string; value: string }[]; change: number | null; change_pct: number | null }[];
};

export function LabCommentary({ orderId }: { orderId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const m = useMutation({ mutationFn: () => api(`/orders/${orderId}/commentary`, { method: 'POST' }).then((r) => r.data as Commentary) });
  const d = m.data;
  if (!open) return (
    <Button size="sm" className="mt-2" icon={<Sparkles className="h-4 w-4 text-brand-600" />} onClick={() => { setOpen(true); if (!m.data) m.mutate(); }}>{t('labai.button')}</Button>
  );
  const trend = d?.params.filter((p) => p.previous.length) ?? [];
  return (
    <section aria-label={t('labai.title')} className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[0.9375rem]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" />{t('labai.title')}</h4>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('labai.hide')}</Button>
      </div>
      {m.isPending && <p className="text-slate-600" role="status">…</p>}
      {m.isError && <div className="space-y-2"><Alert tone="red">{(m.error as Error).message}</Alert><Button size="sm" onClick={() => m.mutate()}>{t('common.retry')}</Button></div>}
      {d && (
        <div className="space-y-2">
          {d.critical.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-900">
              <p className="flex items-center gap-1.5 font-bold"><ShieldAlert className="h-4 w-4" aria-hidden="true" />{t('labai.critical')}</p>
              <ul className="mt-1 space-y-0.5">{d.critical.map((c) => <li key={c.code}>{c.text}</li>)}</ul>
            </div>
          )}
          <ul className="list-disc space-y-1 pl-5 text-slate-900">{d.sentences.map((s, i) => <li key={i}>{s.text}</li>)}</ul>
          {trend.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem]">
                <caption className="pb-1 text-left font-semibold text-slate-700">{t('labai.history')}</caption>
                <thead><tr className="text-left text-slate-600"><th className="py-0.5 pr-2 font-semibold">{t('lab.param')}</th><th className="py-0.5 pr-2 font-semibold">{t('labai.history')}</th><th className="py-0.5 pr-2 text-right font-semibold">{t('labai.now')}</th><th className="py-0.5 text-right font-semibold">{t('labai.change')}</th></tr></thead>
                <tbody>{trend.map((p) => (
                  <tr key={p.code} className="border-t border-slate-200">
                    <td className="py-0.5 pr-2">{p.name}</td>
                    <td className="py-0.5 pr-2 tabular-nums text-slate-700">{p.previous.map((x) => `${x.value} (${fmtDate(x.date)})`).join(' · ')}</td>
                    <td className="whitespace-nowrap py-0.5 pr-2 text-right tabular-nums font-medium">{p.value} <span className="text-slate-600">{p.unit}</span></td>
                    <td className="whitespace-nowrap py-0.5 text-right tabular-nums">{p.change === null ? '—' : `${p.change > 0 ? '+' : ''}${p.change}${p.change_pct === null ? '' : ` (${p.change_pct > 0 ? '+' : ''}${p.change_pct}%)`}`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="text-[0.8125rem] text-slate-600">{t(d.source === 'model' ? 'labai.source.model' : d.mode === 'sample' ? 'labai.source.sample' : 'labai.source.template')}{d.reason ? ` · ${d.reason}` : ''}</p>
        </div>
      )}
    </section>
  );
}
