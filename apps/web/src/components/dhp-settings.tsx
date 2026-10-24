'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, MinusCircle, RotateCcw } from 'lucide-react';
import { translate, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { addDays, fmtDateTime, formatLocale, pid } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { DateRange } from './date-range';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingRows, Select, Table, Td, Th, useToast } from './ui';

type Mode = 'off' | 'export' | 'live';
type Status = 'pending' | 'ready' | 'sent' | 'failed' | 'skipped';
type Settings = {
  mode: Mode; endpoint: string | null; has_token: boolean; last_error: string | null; last_error_at: string | null; last_sent_at: string | null;
  counts: Record<Status, number>; without_pinfl: number; secrets_configured: boolean; export_max_days: number;
};
type Row = { id: string; resource_type: string; version: number; status: Status; attempts: number; error: string | null; created_at: string; patient_number: number };
const TONE: Record<Status, 'gray' | 'blue' | 'green' | 'red' | 'yellow'> = { pending: 'yellow', ready: 'blue', sent: 'green', failed: 'red', skipped: 'gray' };
const STATUSES: Status[] = ['pending', 'ready', 'sent', 'failed', 'skipped'];

/** Settings → DMED: mode, platform address and token (write-only), queue counts, the FHIR file download and the latest rows (no clinical content). */
export function DhpSettings() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSession();
  const q = useQuery({ queryKey: ['dhp', 'settings'], queryFn: () => api<{ data: Settings }>('/dhp/settings').then((r) => r.data) });
  const list = useQuery({ queryKey: ['dhp', 'outbox'], queryFn: () => api<{ data: Row[] }>('/dhp/outbox').then((r) => r.data), refetchInterval: 60_000 });
  const [mode, setMode] = useState<Mode>('off');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(addDays(me.today, -6));
  const [to, setTo] = useState(me.today);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => { if (q.data) { setMode(q.data.mode); setEndpoint(q.data.endpoint ?? ''); } }, [q.data]);

  const save = useMutation({
    mutationFn: () => api<{ data: Settings }>('/dhp/settings', { method: 'PUT', body: { mode, endpoint: endpoint.trim() || null, token: token.trim() || undefined } }),
    onSuccess: () => { setToken(''); setErrors({}); qc.invalidateQueries({ queryKey: ['dhp'] }); toast.success(t('admin.dhp.saved')); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); else toast.error(e); },
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/dhp/outbox/${id}/retry`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dhp'] }); toast.success(t('admin.dhp.retried')); },
    onError: (e) => toast.error(e),
  });

  // sealed download: the bundles hold clinical records, so the page never renders them
  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/v1/dhp/export.ndjson?from=${from}&to=${to}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) {
        let msg = translate(formatLocale(), 'net.failed');
        try { msg = (await res.json())?.error?.message ?? msg; } catch { /* non-JSON */ }
        throw new ApiError(res.status, 'EXPORT', msg);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `med-uz-ai-dhp-${from}_${to}.ndjson`; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(t('admin.dhp.exportDone'));
    } catch (e) { toast.error(e); } finally { setDownloading(false); }
  };

  if (q.isLoading) return <Card><LoadingRows rows={4} /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const s = q.data!;
  const dirty = mode !== s.mode || endpoint.trim() !== (s.endpoint ?? '') || token !== '';

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card title={t('admin.dhp.title')}>
          <div className="flex flex-col gap-4">
            <p className="text-body text-slate-700">{t('admin.dhp.intro')}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 px-4 py-3">
              {s.mode === 'off' ? <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.dhp.mode.off')}</Badge>
                : <Badge tone={s.mode === 'live' ? 'green' : 'blue'} icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t(`admin.dhp.mode.${s.mode}` as MessageKey)}</Badge>}
              {s.last_sent_at && <span className="text-small text-slate-600">{t('admin.dhp.lastSent', { at: fmtDateTime(s.last_sent_at) })}</span>}
            </div>
            {s.last_error && <Alert tone="red" title={t('admin.dhp.broken')}>{s.last_error}{s.last_error_at ? ` (${fmtDateTime(s.last_error_at)})` : ''}</Alert>}
            {!s.secrets_configured && <Alert tone="yellow" title={t('admin.tg.noSecretsTitle')}>{t('admin.tg.noSecrets', { key: 'APP_SECRET_KEY' })}</Alert>}
            <form className="flex max-w-xl flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setErrors({}); save.mutate(); }}>
              <Field label={t('admin.dhp.mode')} error={errors.mode} hint={t(`admin.dhp.modeHint.${mode}` as MessageKey)}>
                {(id) => <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{(['off', 'export', 'live'] as Mode[]).map((m) => <option key={m} value={m}>{t(`admin.dhp.mode.${m}` as MessageKey)}</option>)}</Select>}
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('admin.dhp.endpoint')} error={errors.endpoint}>{(id) => <Input id={id} type="url" autoComplete="off" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://playground.dhp.uz/fhir" invalid={!!errors.endpoint} />}</Field>
                <Field label={t('admin.dhp.token')} error={errors.token} hint={s.has_token ? t('admin.dhp.tokenKept') : undefined}>
                  {(id) => <Input id={id} type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.has_token ? '••••••••' : ''} disabled={!s.secrets_configured} invalid={!!errors.token} />}
                </Field>
              </div>
              <div><Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>{t('common.save')}</Button></div>
            </form>
          </div>
        </Card>

        <Card title={t('admin.dhp.exportTitle')}>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <DateRange from={from} to={to} onFrom={setFrom} onTo={(v) => setTo(v)} />
            <Button icon={<Download className="h-4 w-4" />} loading={downloading} onClick={download}>{t('admin.dhp.export')}</Button>
          </div>
          <p className="mt-2 text-small text-slate-600">{t('admin.dhp.periodHint')}</p>
        </Card>

        <Card title={t('admin.dhp.recent')} padded={false}>
          {list.isLoading ? <LoadingRows rows={4} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data!.length ? <EmptyState compact title={t('admin.dhp.empty')} /> : (
            <Table>
              <thead><tr><Th>{t('admin.dhp.colTime')}</Th><Th>{t('admin.dhp.colKind')}</Th><Th className="hidden sm:table-cell">{t('admin.dhp.colPatient')}</Th><Th>{t('admin.dhp.colStatus')}</Th></tr></thead>
              <tbody>{list.data!.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap tabular-nums text-slate-700">{fmtDateTime(r.created_at)}</Td>
                  <Td className="text-slate-900">{t(`admin.dhp.kind.${r.resource_type}` as MessageKey)}<div className="text-small text-slate-600 sm:hidden">{pid(r.patient_number)}</div></Td>
                  <Td className="hidden tabular-nums text-slate-700 sm:table-cell">{pid(r.patient_number)}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TONE[r.status]}>{t(`admin.dhp.status.${r.status}` as MessageKey)}</Badge>
                      {r.status === 'failed' && s.mode !== 'off' && <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} loading={retry.isPending && retry.variables === r.id} onClick={() => retry.mutate(r.id)}>{t('admin.dhp.retry')}</Button>}
                    </div>
                    {r.error && <div className="mt-1 max-w-[22rem] break-words text-small text-red-700">{r.error}</div>}
                  </Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card title={t('admin.dhp.queue')} padded={false}>
        <dl className="divide-y divide-slate-100">
          {STATUSES.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <dt><Badge tone={TONE[k]}>{t(`admin.dhp.status.${k}` as MessageKey)}</Badge></dt>
              <dd className="tabular-nums text-base font-semibold text-slate-900">{s.counts[k]}</dd>
            </div>
          ))}
        </dl>
        {s.without_pinfl > 0 && <p className="border-t border-slate-100 px-5 py-3 text-small font-medium text-amber-800">{t('admin.dhp.withoutPinfl', { n: s.without_pinfl })}</p>}
      </Card>
    </div>
  );
}
