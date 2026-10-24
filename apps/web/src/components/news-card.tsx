'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, ExternalLink, Newspaper } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Button, Card, cx, EmptyState, LoadingRows, Select } from '@/components/ui';
import { ArticleTitle, NewsSourceLine, pubDate, RateButtons, useNewsActions, useSpLabel, type NewsResponse } from '@/components/news';

/**
 * «Bugun sohangizda». Doctor: the 3 newest unread articles of the personal feed (own specialty + followed topics)
 * and a link to /news. Manager (settings → AI, `canPick`): a preview of one specialty.
 */
export function NewsCard({ canPick = false, canRate = true, initial = 3 }: { canPick?: boolean; canRate?: boolean; initial?: number }) {
  const { me } = useSession();
  return me.role === 'doctor' && !canPick ? <DoctorNewsCard /> : <PreviewNewsCard canPick={canPick} canRate={canRate} initial={initial} />;
}

const cardTitle = (title: string, extra?: React.ReactNode) => (
  <span className="flex items-center gap-2"><Newspaper className="h-5 w-5 shrink-0 text-brand-600" />{title}{extra}</span>
);

function DoctorNewsCard() {
  const { t } = useI18n();
  const sp = useSpLabel();
  const actions = useNewsActions();
  const q = useQuery({ queryKey: ['news', 'feed', ''], queryFn: () => api<NewsResponse>('/news'), staleTime: 60_000 });
  const items = q.data?.data ?? [];
  const meta = q.data?.meta;
  const unread = items.filter((n) => !n.read_at);
  const shown = unread.slice(0, 3);
  const count = meta?.unread ?? unread.length;
  return (
    <Card padded={false} title={cardTitle(t('news.title'), count > 0 && (
      <span className="rounded-full bg-sky-50 px-2 text-small font-semibold tabular-nums text-sky-800 ring-1 ring-inset ring-sky-200" title={t('news.unread', { n: count })}>
        <span aria-hidden="true">{count}</span><span className="sr-only">{t('news.unread', { n: count })}</span>
      </span>
    ))}>
      {q.isLoading ? <LoadingRows rows={3} /> : !items.length ? (
        <EmptyState compact title={t('news.empty')} text={meta?.news_enabled === false ? t('news.disabled') : t('news.emptyText')} />
      ) : !shown.length ? <EmptyState compact icon={<Check />} title={t('news.noUnread')} /> : (
        <ul className="divide-y divide-slate-100">
          {shown.map((n) => (
            <li key={n.id} data-news-item={n.id} className="px-5 py-3 text-sm">
              <ArticleTitle item={n} className="text-body" onOpen={() => actions.read.mutate(n.id)} />
              {n.takeaway_uz && <p className="mt-1 leading-snug text-slate-800"><b className="font-semibold">{t('news.takeaway')}</b> <span lang="uz-Latn">{n.takeaway_uz}</span></p>}
              <div className="mt-1 flex items-center gap-2 text-small text-slate-600">
                <span className="min-w-0 truncate">{[sp(n.specialty_key), n.journal].filter(Boolean).join(' · ')}</span>
                <Button size="sm" variant="ghost" className="ml-auto shrink-0" loading={actions.read.isPending && actions.read.variables === n.id}
                  icon={<Check className="h-4 w-4" />} onClick={() => actions.read.mutate(n.id)}>{t('news.markRead')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link href="/news" className="flex min-h-control items-center gap-2 border-t border-slate-100 px-5 py-2 text-sm font-semibold text-brand-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-focus">
        {t('news.allNews')}<ArrowRight className="h-4 w-4" />
      </Link>
      <NewsSourceLine items={items} />
    </Card>
  );
}

/** Manager's preview: one specialty at a time, read-only. */
function PreviewNewsCard({ canPick, canRate, initial }: { canPick: boolean; canRate: boolean; initial: number }) {
  const { t } = useI18n();
  const sp = useSpLabel();
  const actions = useNewsActions();
  const [specialty, setSpecialty] = useState<string>('');
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['news', specialty], queryFn: () => api<NewsResponse>(`/news${specialty ? `?specialty=${specialty}` : ''}`), staleTime: 10 * 60_000 });
  const items = q.data?.data ?? [];
  const meta = q.data?.meta;
  const shown = all ? items : items.slice(0, initial);

  return (
    <Card padded={false}
      // the specialty sits under the title, so a narrow column never squeezes the title into two lines
      title={<span className="flex flex-col">{cardTitle(t('news.title'))}
        {!canPick && meta && <span className="text-small font-normal text-slate-600">{sp(meta.specialty, meta.label)}</span>}</span>}
      actions={canPick && meta ? (
        <Select size="sm" aria-label={t('news.specialty')} className="w-auto text-sm" value={specialty || meta.specialty} onChange={(e) => setSpecialty(e.target.value)}>
          {meta.specialties.map((s) => <option key={s.key} value={s.key}>{sp(s.key, s.label)}</option>)}
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
              <div className="mt-1 flex items-center gap-2 text-small text-slate-600">
                <span className="truncate">{[n.journal, pubDate(n.published)].filter(Boolean).join(' · ')}</span>
                {canRate && <span className="ml-auto"><RateButtons item={n} onRate={(useful) => actions.rate.mutate({ id: n.id, useful })} /></span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > initial && <button type="button" onClick={() => setAll((x) => !x)} data-no-press className="min-h-control w-full border-t border-slate-100 px-5 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus">{all ? t('news.less') : t('news.more', { n: items.length - initial })}</button>}
      <NewsSourceLine items={items} />
    </Card>
  );
}
