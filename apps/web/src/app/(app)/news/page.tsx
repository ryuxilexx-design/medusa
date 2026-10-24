'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, ListChecks, Newspaper } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, Card, Chip, EmptyState, ErrorState, LoadingRows, PageHeader, Tabs } from '@/components/ui';
import { NewsArticle, NewsSourceLine, TopicsModal, useNewsActions, useSpLabel, type NewsResponse } from '@/components/news';

export default function NewsPage() { return <Suspense><News /></Suspense>; }

type Tab = 'feed' | 'saved';

/** The doctor's personal news: own specialty + followed topics, and the saved articles. */
function News() {
  const { me } = useSession();
  const t = useT();
  const sp = useSpLabel();
  const router = useRouter();
  const params = useSearchParams();
  const actions = useNewsActions();
  const [picking, setPicking] = useState(false);
  const tab: Tab = params.get('tab') === 'saved' ? 'saved' : 'feed';
  const isDoctor = me.role === 'doctor';
  // the whole feed is always loaded: it gives the topics and the unread count for the tab
  const feed = useQuery({ queryKey: ['news', 'feed', ''], queryFn: () => api<NewsResponse>('/news'), enabled: isDoctor, staleTime: 60_000 });
  const meta = feed.data?.meta;
  const own = meta?.own ?? '';
  const followed = meta?.followed ?? [];
  const topics = own ? [own, ...followed] : [];
  const wanted = params.get('topic') ?? '';
  const topic = topics.includes(wanted) ? wanted : '';
  const one = useQuery({ queryKey: ['news', 'feed', topic], queryFn: () => api<NewsResponse>(`/news?specialty=${encodeURIComponent(topic)}`), enabled: isDoctor && tab === 'feed' && !!topic, staleTime: 60_000 });
  const saved = useQuery({ queryKey: ['news', 'saved'], queryFn: () => api<NewsResponse>('/news?view=saved'), enabled: isDoctor && tab === 'saved' });
  const go = (next: { tab?: Tab; topic?: string }) => {
    const s = new URLSearchParams();
    const nt = next.tab ?? tab;
    if (nt === 'saved') s.set('tab', 'saved');
    const tp = next.topic ?? (nt === 'feed' ? topic : '');
    if (nt === 'feed' && tp) s.set('topic', tp);
    const str = s.toString();
    router.replace(`/news${str ? `?${str}` : ''}`, { scroll: false });
  };

  if (!isDoctor) return <Card><ErrorState error={{ status: 403 }} /></Card>;
  const current = tab === 'saved' ? saved : topic ? one : feed;
  const items = current.data?.data ?? [];
  const label = (k: string) => sp(k, meta?.specialties.find((s) => s.key === k)?.label);
  const subtitle = !own ? undefined : followed.length ? t('news.subtitleMore', { sp: label(own), n: followed.length }) : t('news.subtitle', { sp: label(own) });

  return (
    <>
      <PageHeader title={t('nav.news')} subtitle={subtitle}
        actions={<Button icon={<ListChecks className="h-5 w-5" />} onClick={() => setPicking(true)}>{t('news.topics.pick')}</Button>} />
      <Card padded={false}>
        <div className="px-1 pt-1 sm:px-3">
          <Tabs<Tab> value={tab} onChange={(v) => go({ tab: v, topic: '' })} items={[
            { value: 'feed', label: t('news.tabFeed'), count: meta ? meta.unread ?? 0 : undefined },
            { value: 'saved', label: t('news.tabSaved') },
          ]} />
        </div>
        {tab === 'feed' && topics.length > 1 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3" role="group" aria-label={t('news.topicFilter')} data-testid="news-topics">
            {['', ...topics].map((k) => (
              <Chip key={k || 'all'} pressed={topic === k} onClick={() => go({ topic: k })}>{k ? label(k) : t('news.allTopics')}</Chip>
            ))}
          </div>
        )}
        {current.isLoading || (feed.isLoading && tab === 'feed') ? <LoadingRows rows={5} />
          : current.isError ? <ErrorState error={current.error} onRetry={() => current.refetch()} />
          : !items.length ? (
            tab === 'saved' ? <EmptyState icon={<Bookmark />} title={t('news.savedEmpty')} text={t('news.savedEmptyText')} />
              : topic ? <EmptyState icon={<Newspaper />} title={t('news.topicEmpty')} />
              : <EmptyState icon={<Newspaper />} title={t('news.empty')} text={meta?.news_enabled === false ? t('news.disabled') : t('news.emptyText')} />
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="news-list">
              {items.map((n) => <NewsArticle key={n.id} item={n} topicLabel={tab === 'saved' || (topics.length > 1 && !topic) ? label(n.specialty_key) : undefined} actions={actions} />)}
            </ul>
          )}
        <NewsSourceLine items={items} />
      </Card>
      <TopicsModal open={picking} onClose={() => setPicking(false)} onSaved={(keys) => { if (topic && topic !== own && !keys.includes(topic)) go({ topic: '' }); }} />
    </>
  );
}
