'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, ErrorState, LoadingRows, Table, Td, Th, useToast } from '@/components/ui';
import { NewsCard } from '@/components/news-card';

type Usage = {
  mode: 'off' | 'sample' | 'live'; provider: 'anthropic' | 'gemini'; model: string; key_configured: boolean; gemini_free: boolean; clinical_allowed: boolean;
  by_route: { route: string; calls: number; ok: number; failed: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number; avg_latency_ms: number | null }[];
  today: { calls: number; cost_usd: number }; icd10: { n: number; official: number };
};
const ROUTE: Record<string, MessageKey> = { note_draft: 'admin.ai.routeNote', icd10_suggest: 'admin.ai.routeIcd', news_summary: 'admin.ai.routeNews' };
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
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const u = q.data!;
  const total = u.by_route.reduce((a, b) => a + b.cost_usd, 0);
  const pv = PROVIDER[u.provider] ?? PROVIDER.anthropic;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        <section className="flex flex-wrap items-center gap-3">
          <Badge tone={MODE[u.mode][1]}>{t(MODE[u.mode][0])}</Badge>
          {u.mode === 'live' && <span className="text-sm text-slate-700">{pv.name}, <code>{u.model}</code>{u.gemini_free && `, ${t('admin.ai.freeTier')}`}</span>}
          <span className="text-sm text-slate-600">{t('admin.ai.today', { n: u.today.calls, cost: usd(u.today.cost_usd) })}</span>
        </section>
        {u.mode !== 'live' && (
          <Alert tone="yellow" title={t('admin.ai.notLiveTitle')}>
            {u.key_configured ? t('admin.ai.keyNotLive') : t('admin.ai.noKey')} {t('admin.ai.notLiveText')}
          </Alert>
        )}
        {u.mode === 'live' && u.gemini_free && (
          <Alert tone={u.clinical_allowed ? 'yellow' : 'red'} title={t('admin.ai.geminiTitle')}>
            {t('admin.ai.geminiText', { company: 'Google' })}{' '}
            {u.clinical_allowed
              ? t('admin.ai.geminiAllowed')
              : t('admin.ai.geminiBlocked')}
          </Alert>
        )}
        <section>
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.ai.last30')}</h3>
          {!u.by_route.length ? <p className="mt-1 text-sm text-slate-600">{t('admin.ai.noCalls')}</p> : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <thead><tr><Th>{t('admin.ai.colService')}</Th><Th right>{t('admin.ai.colCalls')}</Th><Th right>{t('admin.ai.colErrors')}</Th><Th right>{t('admin.ai.colTokens')}</Th><Th right>{t('admin.ai.colLatency')}</Th><Th right>{t('admin.ai.colCost')}</Th></tr></thead>
                <tbody>{u.by_route.map((r) => (
                  <tr key={r.route}>
                    <Td>{ROUTE[r.route] ? t(ROUTE[r.route]) : r.route}</Td><Td right>{r.calls}</Td><Td right>{r.failed || '—'}</Td>
                    <Td right className="tabular-nums">{r.input_tokens.toLocaleString('ru-RU')} / {r.output_tokens.toLocaleString('ru-RU')}</Td>
                    <Td right>{r.avg_latency_ms != null ? t('admin.ai.seconds', { s: (r.avg_latency_ms / 1000).toFixed(1) }) : '—'}</Td><Td right className="tabular-nums">{usd(r.cost_usd)}</Td>
                  </tr>
                ))}</tbody>
                <tfoot><tr className="border-t border-slate-200 font-medium"><Td>{t('admin.ai.total')}</Td><Td right>{u.by_route.reduce((a, b) => a + b.calls, 0)}</Td><Td /><Td /><Td /><Td right className="tabular-nums">{usd(total)}</Td></tr></tfoot>
              </Table>
            </div>
          )}
          <p className="mt-1 text-[0.8125rem] text-slate-600">{u.gemini_free ? t('admin.ai.freeCost') : t('admin.ai.estCost', { provider: pv.name })} {t('admin.ai.costFoot', { console: pv.console })}</p>
        </section>
        <section className="text-sm text-slate-600">
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.ai.icdTitle')}</h3>
          <p className="mt-1">{t('admin.ai.icdCount', { n: u.icd10.n })}{u.icd10.official ? t('admin.ai.icdOfficial', { n: u.icd10.official }) : t('admin.ai.icdStarter')}.
            {!u.icd10.official && <> {t('admin.ai.icdImport')}</>}</p>
        </section>
        {(u.mode !== 'live' || !u.icd10.official) && (
          <details className="text-[0.8125rem] text-slate-600">
            <summary className="cursor-pointer rounded font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{t('admin.ai.adminDetails')}</summary>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {u.mode !== 'live' && <li>{t('admin.ai.adminKey', { key: pv.key, setting: 'AI_MODE=live' })}</li>}
              {!u.icd10.official && <li>{t('admin.ai.adminIcd', { cmd: 'npm run db:import-icd10 -- fayl.csv' })}</li>}
            </ul>
          </details>
        )}
        <section className="text-sm text-slate-600">
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.ai.security')}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>{t('admin.ai.sec1')}</li>
            <li>{t('admin.ai.sec2')}</li>
            <li>{t('admin.ai.sec3')}</li>
          </ul>
        </section>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{t('admin.ai.newsTitle')}</h3>
          <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>{t('admin.ai.refreshNow')}</Button>
        </div>
        <NewsCard canPick canRate={false} initial={5} />
      </div>
    </div>
  );
}
