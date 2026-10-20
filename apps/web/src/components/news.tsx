'use client';
// Shared pieces of the doctor's specialty news: labels, actions (read / save / rate), one article row, the source
// line and the «Mavzularni tanlash» dialog. Used by the /news page and the cabinet card (news-card.tsx).
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkCheck, Check, ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';
import { MESSAGES, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Alert, Badge, Button, cx, LoadingRows, Modal, ModalCancel, useToast } from '@/components/ui';

export type NewsItem = {
  id: string; specialty_key: string; title: string; title_uz: string | null; summary_uz: string | null; takeaway_uz: string | null;
  journal: string | null; published: string | null; url: string; fetched_on: string; model: string | null; useful: boolean | null;
  read_at?: string | null; saved_at?: string | null;
};
export type Topic = { key: string; label: string };
export type NewsMeta = {
  specialty: string; label: string; specialties: Topic[]; news_enabled: boolean; ai_mode: string;
  own?: string; followed?: string[]; unread?: number;
};
export type NewsResponse = { data: NewsItem[]; meta: NewsMeta };
type Topics = { own: string; followed: string[]; all: Topic[]; max: number };

/** Specialty name in the interface language; the server's Uzbek label when the key has no translation. */
export function useSpLabel() {
  const { t } = useI18n();
  return (key: string, fallback?: string) => {
    const k = `news.sp.${key}`;
    return k in MESSAGES ? t(k as MessageKey) : fallback ?? key;
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** PubMed's «2026 Oct 01» / «2026 Oct» as 01.10.2026 / 10.2026; anything else as given. */
export function pubDate(s: string | null) {
  const m = s?.match(/^(\d{4})(?: ([A-Z][a-z]{2}))?(?: (\d{1,2}))?/);
  if (!m) return s ?? '';
  const mi = m[2] ? MONTHS.indexOf(m[2]) + 1 : 0;
  if (!mi) return m[1];
  const mm = String(mi).padStart(2, '0');
  return m[3] ? fmtDate(`${m[1]}-${mm}-${m[3].padStart(2, '0')}`) : `${mm}.${m[1]}`;
}

/** Read / save / rate an article; every change refreshes all news lists (unread counts included). */
export function useNewsActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const done = () => qc.invalidateQueries({ queryKey: ['news'] });
  const read = useMutation({ mutationFn: (id: string) => api(`/news/${id}/read`, { method: 'POST' }), onSuccess: done, onError: (e) => toast.error(e) });
  const save = useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) => api(`/news/${id}/save`, { method: 'POST', body: { saved } }),
    onSuccess: done, onError: (e) => toast.error(e),
  });
  const rate = useMutation({
    mutationFn: ({ id, useful }: { id: string; useful: boolean }) => api(`/news/${id}/feedback`, { method: 'POST', body: { useful } }),
    onSuccess: done, onError: (e) => toast.error(e),
  });
  return { read, save, rate };
}

const iconBtn = 'rounded-lg p-2.5 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300';

/** Thumbs up / down (the existing «Foydali» feedback). */
export function RateButtons({ item, onRate }: { item: NewsItem; onRate: (useful: boolean) => void }) {
  const { t } = useI18n();
  return (
    <span className="flex shrink-0 gap-1">
      <button type="button" aria-label={t('news.useful')} aria-pressed={item.useful === true} title={t('news.useful')} onClick={() => onRate(true)}
        className={cx(iconBtn, item.useful === true ? 'text-emerald-700' : 'text-slate-500')}><ThumbsUp className="h-5 w-5" /></button>
      <button type="button" aria-label={t('news.notUseful')} aria-pressed={item.useful === false} title={t('news.notUseful')} onClick={() => onRate(false)}
        className={cx(iconBtn, item.useful === false ? 'text-red-700' : 'text-slate-500')}><ThumbsDown className="h-5 w-5" /></button>
    </span>
  );
}

/** Article title (Uzbek when AI translated it; the original then smaller under it). Opening it marks it read. */
export function ArticleTitle({ item, onOpen, className }: { item: NewsItem; onOpen?: () => void; className?: string }) {
  return (
    <>
      <a href={item.url} target="_blank" rel="noopener noreferrer" lang={item.title_uz ? 'uz-Latn' : 'en'} onClick={onOpen}
        className={cx('font-bold leading-snug text-slate-900 [overflow-wrap:anywhere] hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', className)}>
        {item.title_uz ?? item.title}
      </a>
      {item.title_uz && <p lang="en" className="mt-0.5 text-[0.8125rem] leading-snug text-slate-600 [overflow-wrap:anywhere]">{item.title}</p>}
    </>
  );
}

/** One article in the /news list. */
export function NewsArticle({ item, topicLabel, actions }: { item: NewsItem; topicLabel?: string; actions: ReturnType<typeof useNewsActions> }) {
  const { t } = useI18n();
  const unread = !item.read_at;
  const saved = !!item.saved_at;
  const busySave = actions.save.isPending && actions.save.variables?.id === item.id;
  const busyRead = actions.read.isPending && actions.read.variables === item.id;
  const open = () => { if (unread) actions.read.mutate(item.id); };
  return (
    <li data-news-item={item.id} data-unread={unread || undefined} className={cx('px-5 py-4', unread && 'bg-brand-50/40 shadow-[inset_4px_0_0_#2d64bd]')}>
      {(topicLabel || unread) && <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {topicLabel && <Badge tone="teal">{topicLabel}</Badge>}
        {unread && <Badge tone="blue" icon={<span className="h-2 w-2 rounded-full bg-sky-600" aria-hidden="true" />}>{t('news.new')}</Badge>}
      </div>}
      <h3 className="text-base"><ArticleTitle item={item} onOpen={open} /></h3>
      {item.summary_uz && <p lang="uz-Latn" className="mt-1.5 line-clamp-3 text-[0.9375rem] leading-snug text-slate-800">{item.summary_uz}</p>}
      {item.takeaway_uz && <p className="mt-1.5 text-[0.9375rem] leading-snug text-slate-800"><b className="font-semibold">{t('news.takeaway')}</b> <span lang="uz-Latn">{item.takeaway_uz}</span></p>}
      <p className="mt-1.5 text-[0.8125rem] text-slate-600 [overflow-wrap:anywhere]">{[item.journal, pubDate(item.published)].filter(Boolean).join(' · ')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={open}
          className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">
          <ExternalLink className="h-4 w-4" />{t('news.open')}
        </a>
        <Button size="sm" variant="ghost" aria-pressed={saved} loading={busySave} className={saved ? 'text-emerald-800 hover:bg-emerald-50' : undefined}
          icon={saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />} onClick={() => actions.save.mutate({ id: item.id, saved: !saved })}>
          {saved ? t('news.saved') : t('news.save')}
        </Button>
        {unread && <Button size="sm" variant="ghost" loading={busyRead} icon={<Check className="h-4 w-4" />} onClick={() => actions.read.mutate(item.id)}>{t('news.markRead')}</Button>}
        <span className="ml-auto"><RateButtons item={item} onRate={(useful) => actions.rate.mutate({ id: item.id, useful })} /></span>
      </div>
    </li>
  );
}

/** One short line under the list: source, AI note, «not a treatment guideline». */
export function NewsSourceLine({ items }: { items: NewsItem[] }) {
  const { t, locale } = useI18n();
  if (!items.length) return null;
  const latest = items.reduce((a, x) => (x.fetched_on > a ? x.fetched_on : a), items[0].fetched_on);
  return (
    <p className="border-t border-slate-100 px-5 py-2.5 text-[0.8125rem] leading-snug text-slate-600">
      {t('news.source')} {items.some((x) => x.model) ? `${t('news.aiNote')} ` : ''}{locale !== 'uz' && items.some((x) => x.summary_uz) ? `${t('news.uzOnly')} ` : ''}{t('news.disclaimer', { date: fmtDate(latest) })}
    </p>
  );
}

/** «Mavzularni tanlash»: own specialty always on, up to `max` extra topics. */
export function TopicsModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (followed: string[]) => void }) {
  const { t, locale } = useI18n();
  const sp = useSpLabel();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['news', 'topics'], queryFn: () => api<{ data: Topics }>('/news/topics').then((r) => r.data), enabled: open });
  // null = untouched: the saved topics are shown; a refetch while the dialog is open never drops the person's picks
  const [touched, setTouched] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (!open) { setTouched(null); setError(''); } }, [open]);
  const picked = touched ?? q.data?.followed ?? [];
  const save = useMutation({
    mutationFn: (keys: string[]) => api<{ data: { own: string; followed: string[] } }>('/news/topics', { method: 'PUT', body: { keys } }),
    onSuccess: (r) => {
      const added = r.data.followed.some((k) => !q.data?.followed.includes(k));
      qc.invalidateQueries({ queryKey: ['news'] });
      toast.success(added ? t('news.topics.savedNew') : t('news.topics.saved'));
      onSaved?.(r.data.followed);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? (e.fields?.keys ? `${e.message}: ${e.fields.keys}` : e.message) : String(e)),
  });
  const d = q.data;
  const max = d?.max ?? 5;
  const full = picked.length >= max;
  const dirty = !!d && !!touched && (picked.length !== d.followed.length || picked.some((k) => !d.followed.includes(k)));
  const all = d ? [...d.all].map((s) => ({ ...s, name: sp(s.key, s.label) }))
    .sort((a, b) => (a.key === d.own ? -1 : b.key === d.own ? 1 : a.name.localeCompare(b.name, locale === 'ru' ? 'ru' : 'uz'))) : [];
  const toggle = (k: string) => { setError(''); setTouched(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]); };
  return (
    <Modal open={open} onClose={onClose} title={t('news.topics.title')} width="max-w-3xl" dirty={dirty && !save.isPending}
      footer={<>
        <span className={cx('mr-auto text-sm font-semibold tabular-nums', full ? 'text-amber-800' : 'text-slate-700')} data-testid="topics-count">
          {t('news.topics.count', { n: picked.length, max })}{full ? ` · ${t('news.topics.limit', { max })}` : ''}
        </span>
        <ModalCancel />
        <Button variant="primary" loading={save.isPending} disabled={!d} onClick={() => save.mutate(picked)}>{t('common.save')}</Button>
      </>}>
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <Alert tone="red">{(q.error as Error).message}</Alert> : d && (
        <>
          {error && <div className="mb-3"><Alert tone="red">{error}</Alert></div>}
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {all.map((s, i) => {
              const own = s.key === d.own;
              const on = own || picked.includes(s.key);
              const disabled = own || (!on && full);
              return (
                <li key={s.key}>
                  <label data-topic={s.key} className={cx('flex min-h-11 items-center gap-3 rounded-lg border-2 px-3 py-2 text-[0.9375rem]',
                    on ? 'border-brand-600 bg-brand-50 text-slate-900' : 'border-slate-200 text-slate-800', disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:border-slate-400', disabled && !on && 'opacity-60')}>
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={on} disabled={disabled} onChange={() => toggle(s.key)}
                      data-autofocus={i === (all[0]?.key === d.own ? 1 : 0) || undefined} />
                    <span className="min-w-0 leading-snug">
                      <span className="block font-semibold">{s.name}</span>
                      {own && <span className="block text-[0.8125rem] text-slate-600">{t('news.topics.own')}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
