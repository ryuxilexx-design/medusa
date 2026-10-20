'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Newspaper, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Card, cx, EmptyState, LoadingRows, Select, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

type Item = { id: string; title: string; title_uz: string | null; summary_uz: string | null; takeaway_uz: string | null; journal: string | null; published: string | null; url: string; fetched_on: string; model: string | null; useful: boolean | null };
type Meta = { specialty: string; label: string; specialties: { key: string; label: string }[]; news_enabled: boolean; ai_mode: string };

/** «Bugun sohangizda»: recent high-evidence articles for the doctor's specialty, summarised in Uzbek. */
export function NewsCard({ canPick = false, canRate = true, initial = 3 }: { canPick?: boolean; canRate?: boolean; initial?: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t, locale } = useI18n();
  const [specialty, setSpecialty] = useState<string>('');
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['news', specialty], queryFn: () => api<{ data: Item[]; meta: Meta }>(`/news${specialty ? `?specialty=${specialty}` : ''}`), staleTime: 10 * 60_000 });
  const rate = useMutation({
    mutationFn: ({ id, useful }: { id: string; useful: boolean }) => api(`/news/${id}/feedback`, { method: 'POST', body: { useful } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['news'] }),
    onError: (e) => toast.error(e),
  });
  const items = q.data?.data ?? [];
  const meta = q.data?.meta;
  const shown = all ? items : items.slice(0, initial);

  return (
    <Card padded={false}
      // the specialty sits under the title, so a narrow column never squeezes the title into two lines
      title={<span className="flex flex-col"><span className="flex items-center gap-2"><Newspaper className="h-5 w-5 shrink-0 text-brand-600" />{t('news.title')}</span>
        {!canPick && meta && <span className="text-[0.8125rem] font-normal text-slate-600">{meta.label}</span>}</span>}
      actions={canPick && meta ? (
        <Select aria-label={t('news.specialty')} className="h-9 w-auto text-sm" value={specialty || meta.specialty} onChange={(e) => setSpecialty(e.target.value)}>
          {meta.specialties.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
      ) : undefined}>
      {q.isLoading ? <LoadingRows rows={3} /> : !items.length ? (
        <EmptyState title={t('news.empty')} text={meta?.news_enabled === false ? t('news.disabled') : t('news.emptyText')} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((n) => (
            <li key={n.id} className="px-5 py-3 text-sm">
              <a href={n.url} target="_blank" rel="noopener noreferrer" lang={n.title_uz ? 'uz-Latn' : 'en'} className="font-semibold leading-snug text-slate-900 hover:text-brand-700 hover:underline">
                {n.title_uz ?? n.title}<ExternalLink className="ml-1 inline h-3.5 w-3.5 align-baseline text-slate-500" />
              </a>
              {n.summary_uz && <p className="mt-1 leading-snug text-slate-800" lang="uz-Latn">{n.summary_uz}</p>}
              {n.takeaway_uz && <p className="mt-1 leading-snug text-slate-700"><b className="font-semibold">{t('news.takeaway')}</b> <span lang="uz-Latn">{n.takeaway_uz}</span></p>}
              <div className="mt-1 flex items-center gap-2 text-[0.8125rem] text-slate-600">
                <span className="truncate">{[n.journal, n.published].filter(Boolean).join(', ')}</span>
                {canRate && (
                  <span className="ml-auto flex shrink-0 gap-1">
                    <button type="button" aria-label={t('news.useful')} aria-pressed={n.useful === true} title={t('news.useful')} onClick={() => rate.mutate({ id: n.id, useful: true })}
                      className={cx('rounded-lg p-2 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', n.useful === true ? 'text-emerald-700' : 'text-slate-500')}><ThumbsUp className="h-4 w-4" /></button>
                    <button type="button" aria-label={t('news.notUseful')} aria-pressed={n.useful === false} title={t('news.notUseful')} onClick={() => rate.mutate({ id: n.id, useful: false })}
                      className={cx('rounded-lg p-2 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', n.useful === false ? 'text-red-700' : 'text-slate-500')}><ThumbsDown className="h-4 w-4" /></button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > initial && <button type="button" onClick={() => setAll((x) => !x)} className="min-h-11 w-full border-t border-slate-100 px-5 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">{all ? t('news.less') : t('news.more', { n: items.length - initial })}</button>}
      {items.length > 0 && (
        <p className="border-t border-slate-100 px-5 py-2.5 text-[0.8125rem] leading-snug text-slate-600">
          {t('news.source')} {items.some((x) => x.model) ? `${t('news.aiNote')} ` : ''}{locale !== 'uz' && items.some((x) => x.summary_uz) ? `${t('news.uzOnly')} ` : ''}{t('news.disclaimer', { date: fmtDate(items[0].fetched_on) })}
        </p>
      )}
    </Card>
  );
}
