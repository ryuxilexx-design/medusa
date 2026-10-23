'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingRows, Table, Td, Th, useToast } from '@/components/ui';
import { NewsCard } from '@/components/news-card';

type Usage = {
  mode: 'off' | 'sample' | 'live'; provider: 'anthropic' | 'gemini'; model: string; key_configured: boolean; gemini_free: boolean; clinical_allowed: boolean;
  by_route: { route: string; calls: number; ok: number; failed: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number; avg_latency_ms: number | null }[];
  today: { calls: number; cost_usd: number }; icd10: { n: number; official: number };
};
const ROUTE: Record<string, MessageKey> = { note_draft: 'admin.ai.routeNote', icd10_suggest: 'admin.ai.routeIcd', news_summary: 'admin.ai.routeNews', bot_faq: 'admin.ai.routeBotFaq' };
const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const PROVIDER = { anthropic: { name: 'Claude (Anthropic)', key: 'ANTHROPIC_API_KEY', console: 'Anthropic Console' }, gemini: { name: 'Gemini (Google)', key: 'GEMINI_API_KEY', console: 'Google AI Studio' } } as const;
const MODE: Record<Usage['mode'], [MessageKey, 'teal' | 'yellow' | 'gray']> = { live: ['admin.ai.modeLive', 'teal'], sample: ['admin.ai.modeSample', 'yellow'], off: ['admin.ai.modeOff', 'gray'] };

/** Settings → AI: mode, model, 30-day usage and estimated cost, ICD-10 table status, news preview. */
export function AiSettings() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ai-usage'], queryFn: () => api<{ data: Usage }>('/ai/usage').then((r) => r.data) });
  const refresh = useMutation({
    mutationFn: () => api<{ data: { specialty: string; added: number; error?: string }[] }>('/news/refresh', { method: 'POST' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['news'] }); qc.invalidateQueries({ queryKey: ['ai-usage'] });
      const added = r.data.reduce((a, b) => a + b.added, 0), failed = r.data.filter((x) => x.error).length;
      if (failed) toast.error(new Error(t('admin.ai.newsFailed', { n: failed })));
      else toast.success(added ? t('admin.ai.newsAdded', { n: added }) : t('admin.ai.newsAlready'));
    },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Card><LoadingRows rows={4} /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const u = q.data!;
  const total = u.by_route.reduce((a, b) => a + b.cost_usd, 0);
  const pv = PROVIDER[u.provider] ?? PROVIDER.anthropic;
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card title={t('admin.ai.status')}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge tone={MODE[u.mode][1]}>{t(MODE[u.mode][0])}</Badge>
              {u.mode === 'live' && <span className="text-[0.9375rem] text-slate-700">{pv.name}, <code>{u.model}</code>{u.gemini_free && `, ${t('admin.ai.freeTier')}`}</span>}
              <span className="text-[0.9375rem] text-slate-600">{t('admin.ai.today', { n: u.today.calls, cost: usd(u.today.cost_usd) })}</span>
            </div>
            {u.mode !== 'live' && (
              <Alert tone="yellow" title={t('admin.ai.notLiveTitle')}>
                {u.key_configured ? t('admin.ai.keyNotLive') : t('admin.ai.noKey')} {t(u.mode === 'sample' ? 'admin.ai.notLiveText' : 'admin.ai.offText')}
              </Alert>
            )}
            {u.mode === 'live' && u.gemini_free && (
              <Alert tone={u.clinical_allowed ? 'yellow' : 'red'} title={t('admin.ai.geminiTitle')}>
                {t('admin.ai.geminiText', { company: 'Google' })}{' '}{u.clinical_allowed ? t('admin.ai.geminiAllowed') : t('admin.ai.geminiBlocked')}
              </Alert>
            )}
            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-[0.9375rem]">
                <h3 className="font-semibold text-slate-900">{t('admin.ai.icdTitle')}</h3>
                <span className="text-slate-700">{t('admin.ai.icdCount', { n: u.icd10.n })}{u.icd10.official ? t('admin.ai.icdOfficial', { n: u.icd10.official }) : t('admin.ai.icdStarter')}</span>
              </div>
            </div>
            {(u.mode !== 'live' || !u.icd10.official) && (
              <details className="text-[0.8125rem] text-slate-600">
                <summary className="cursor-pointer rounded font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{t('admin.ai.adminDetails')}</summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {u.mode !== 'live' && <li>{t('admin.ai.adminKey', { key: pv.key, setting: 'AI_MODE=live' })}</li>}
                  {!u.icd10.official && <li>{t('admin.ai.adminIcd', { cmd: 'npm run db:import-icd10 -- fayl.csv' })}</li>}
                </ul>
              </details>
            )}
          </div>
        </Card>

        <Card title={t('admin.ai.last30')} padded={false}>
          {!u.by_route.length ? <EmptyState compact title={t('admin.ai.noCalls')} /> : (
            <Table>
              <thead><tr><Th>{t('admin.ai.colService')}</Th><Th right>{t('admin.ai.colCalls')}</Th><Th right className="hidden sm:table-cell">{t('admin.ai.colErrors')}</Th><Th right className="hidden lg:table-cell">{t('admin.ai.colTokens')}</Th><Th right className="hidden md:table-cell">{t('admin.ai.colLatency')}</Th><Th right>{t('admin.ai.colCost')}</Th></tr></thead>
              <tbody>{u.by_route.map((r) => (
                <tr key={r.route}>
                  <Td className="min-w-[9rem]">{ROUTE[r.route] ? t(ROUTE[r.route]) : r.route}</Td><Td right>{r.calls}</Td><Td right className="hidden sm:table-cell">{r.failed || '—'}</Td>
                  <Td right className="hidden lg:table-cell">{r.input_tokens.toLocaleString('ru-RU')} / {r.output_tokens.toLocaleString('ru-RU')}</Td>
                  <Td right className="hidden md:table-cell">{r.avg_latency_ms != null ? t('admin.ai.seconds', { s: (r.avg_latency_ms / 1000).toFixed(1) }) : '—'}</Td><Td right>{usd(r.cost_usd)}</Td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="font-semibold"><Td>{t('admin.ai.total')}</Td><Td right>{u.by_route.reduce((a, b) => a + b.calls, 0)}</Td><Td className="hidden sm:table-cell" /><Td className="hidden lg:table-cell" /><Td className="hidden md:table-cell" /><Td right>{usd(total)}</Td></tr></tfoot>
            </Table>
          )}
          <p className="border-t border-slate-100 px-5 py-3 text-[0.8125rem] text-slate-600">{u.gemini_free ? t('admin.ai.freeCost') : t('admin.ai.estCost', { provider: pv.name })} {t('admin.ai.costFoot', { console: pv.console })}</p>
        </Card>

        <Card title={t('admin.ai.security')}>
          <ul className="flex flex-col gap-2 text-[0.9375rem] text-slate-700">
            {(['admin.ai.sec1', 'admin.ai.sec2', 'admin.ai.sec3'] as const).map((k) => <li key={k} className="flex gap-2.5"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />{t(k)}</li>)}
          </ul>
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <NewsCard canPick canRate={false} initial={5} />
        {/* under the card, aligned with its right edge: the card header stays level with the left column */}
        <div className="flex justify-end">
          <Button icon={<RefreshCw className="h-4 w-4" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>{t('admin.ai.refreshNow')}</Button>
        </div>
      </div>
    </div>
  );
}
