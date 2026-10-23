'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Alert, Button, Card, ErrorState, Field, LoadingRows, Textarea, useToast } from '@/components/ui';

type Counts = { ai_answered: number; keyword_answered: number; fallbacks: number; medical: number; limited: number };
type Faq = { ai_enabled: boolean; ai_default: boolean; extra_text: string; extra_max: number; ai_mode: 'off' | 'sample' | 'live'; today: Counts; last7: Counts };

/** Settings → Telegram bot: answers to patients' questions about the clinic (AI switch, extra text, daily counts). */
export function TelegramFaq() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['telegram-faq'], queryFn: () => api<{ data: Faq }>('/telegram/faq').then((r) => r.data), refetchInterval: 60_000 });
  const [enabled, setEnabled] = useState(false);
  const [extra, setExtra] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data && !dirty) { setEnabled(q.data.ai_enabled); setExtra(q.data.extra_text); }
  }, [q.data, dirty]);
  const save = useMutation({
    mutationFn: () => api('/telegram/faq', { method: 'PUT', body: { ai_enabled: enabled, extra_text: extra } }),
    onSuccess: () => { setDirty(false); setError(null); qc.invalidateQueries({ queryKey: ['telegram-faq'] }); toast.success(t('admin.tg.faqSaved')); },
    onError: (e) => setError(e instanceof ApiError && e.fields?.extra_text ? e.fields.extra_text : (e as Error).message),
  });

  if (q.isLoading) return <Card><LoadingRows rows={3} /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const s = q.data!;
  const rows: [string, keyof Counts][] = [
    [t('admin.tg.faqStatAi'), 'ai_answered'], [t('admin.tg.faqStatKeyword'), 'keyword_answered'], [t('admin.tg.faqStatFallback'), 'fallbacks'],
    [t('admin.tg.faqStatMedical'), 'medical'], [t('admin.tg.faqStatLimited'), 'limited'],
  ];

  return (
    <Card title={t('admin.tg.faqTitle')}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (extra.length > s.extra_max) { setError(t('admin.tg.faqTooLong', { max: s.extra_max })); return; } save.mutate(); }}>
        <p className="text-[0.9375rem] text-slate-700">{t('admin.tg.faqIntro')}</p>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] font-medium text-slate-900">
          <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }} />
          {t('admin.tg.faqAi')}
        </label>
        {enabled && s.ai_mode !== 'live' && <Alert tone="yellow">{t('admin.tg.faqAiOff')}</Alert>}
        <Field label={t('admin.tg.faqExtra')} hint={t('admin.tg.faqExtraHint', { n: extra.length, max: s.extra_max })} error={error ?? undefined}>
          {(id) => <Textarea id={id} rows={5} value={extra} maxLength={s.extra_max} invalid={!!error} placeholder={t('admin.tg.faqExtraPlaceholder')}
            onChange={(e) => { setExtra(e.target.value); setDirty(true); setError(null); }} />}
        </Field>
        <div><Button type="submit" loading={save.isPending} disabled={!dirty}>{t('admin.tg.faqSave')}</Button></div>
      </form>
      <table className="mt-5 w-full text-[0.9375rem]">
        <caption className="sr-only">{t('admin.tg.faqStats')}</caption>
        <thead><tr className="text-left text-[0.8125rem] text-slate-600">
          <th scope="col" className="py-1.5 font-semibold">{t('admin.tg.faqStats')}</th>
          <th scope="col" className="whitespace-nowrap py-1.5 pl-3 text-right font-semibold">{t('admin.tg.faqToday')}</th>
          <th scope="col" className="whitespace-nowrap py-1.5 pl-3 text-right font-semibold">{t('admin.tg.faq7')}</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([label, k]) => (
            <tr key={k}><td className="py-2 pr-2 text-slate-700">{label}</td><td className="py-2 pl-3 text-right font-bold tabular-nums text-slate-900">{s.today[k]}</td><td className="py-2 pl-3 text-right font-bold tabular-nums text-slate-900">{s.last7[k]}</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
