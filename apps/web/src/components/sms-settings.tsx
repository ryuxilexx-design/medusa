'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageSquareText, MinusCircle, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingRows, Table, Td, Th, useToast } from '@/components/ui';

type Settings = { eskiz_email: string | null; has_password: boolean; sender: string; enabled: boolean; last_error: string | null; last_error_at: string | null; updated_at: string | null; secrets_configured: boolean };
type Stats = { days: { day: string; sent: number; delivered: number; failed: number; parts: number }[]; totals: { sent_30d: number; failed_30d: number; pending: number }; last_error: string | null; last_error_at: string | null };
const DEFAULT_SENDER = '4546';

/** Settings → SMS: the clinic's Eskiz.uz account (password stored encrypted, never shown again), sender name, on/off, a test message and daily counts. */
export function SmsSettings() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['sms', 'settings'], queryFn: () => api<{ data: Settings }>('/sms/settings').then((r) => r.data) });
  const stats = useQuery({ queryKey: ['sms', 'stats'], queryFn: () => api<{ data: Stats }>('/sms/stats').then((r) => r.data), refetchInterval: 60_000 });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sender, setSender] = useState(DEFAULT_SENDER);
  const [enabled, setEnabled] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testPhone, setTestPhone] = useState('');
  useEffect(() => { if (q.data) { setEmail(q.data.eskiz_email ?? ''); setSender(q.data.sender); setEnabled(q.data.enabled); } }, [q.data]);

  const save = useMutation({
    mutationFn: () => api<{ data: Settings }>('/sms/settings', { method: 'PUT', body: { eskiz_email: email.trim() || undefined, password: password || undefined, sender: sender.trim() || DEFAULT_SENDER, enabled } }),
    onSuccess: () => { setPassword(''); setErrors({}); qc.invalidateQueries({ queryKey: ['sms'] }); toast.success(t('admin.sms.saved')); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); else toast.error(e); },
  });
  const sendTest = useMutation({
    mutationFn: () => api<{ data: { phone: string } }>('/sms/test', { method: 'POST', body: { phone: testPhone.trim() || undefined } }),
    onSuccess: (r) => { setErrors({}); qc.invalidateQueries({ queryKey: ['sms', 'stats'] }); toast.success(t('admin.sms.testSent', { phone: r.data.phone })); },
    onError: (e) => { if (e instanceof ApiError && e.fields?.phone) setErrors({ phone: e.fields.phone }); else toast.error(e); },
  });

  if (q.isLoading) return <Card><LoadingRows rows={4} /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const s = q.data!;
  const dirty = email.trim() !== (s.eskiz_email ?? '') || password !== '' || sender.trim() !== s.sender || enabled !== s.enabled;

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card title={t('admin.sms.account')}>
          <div className="flex flex-col gap-4">
            <p className="text-[0.9375rem] text-slate-700">{t('admin.sms.intro')}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 px-4 py-3">
              <MessageSquareText className="h-5 w-5 text-slate-600" aria-hidden="true" />
              <span className="font-semibold text-slate-900">{s.eskiz_email ?? 'Eskiz.uz'}</span>
              {s.enabled ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('admin.sms.statusOn')}</Badge> : <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.sms.statusOff')}</Badge>}
              {s.updated_at && <span className="text-[0.8125rem] text-slate-600">{t('admin.tg.updatedAt', { at: fmtDateTime(s.updated_at) })}</span>}
            </div>
            {s.last_error && <Alert tone="red" title={t('admin.sms.broken')}>{s.last_error}{s.last_error_at ? ` (${fmtDateTime(s.last_error_at)})` : ''}</Alert>}
            {!s.enabled && (
              <ol className="list-decimal space-y-1.5 pl-5 text-[0.9375rem] text-slate-700">
                <li>{t('admin.sms.step1')}</li>
                <li>{t('admin.sms.step2', { default: DEFAULT_SENDER })}</li>
              </ol>
            )}
            {!s.secrets_configured && <Alert tone="yellow" title={t('admin.tg.noSecretsTitle')}>{t('admin.tg.noSecrets', { key: 'APP_SECRET_KEY' })}</Alert>}
            <form className="flex max-w-xl flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setErrors({}); save.mutate(); }}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('admin.sms.email')} error={errors.eskiz_email}>{(id) => <Input id={id} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.eskiz_email} />}</Field>
                <Field label={t('admin.sms.password')} error={errors.password} hint={s.has_password ? t('admin.sms.passwordKept') : undefined}>
                  {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={s.has_password ? '••••••••' : ''} disabled={!s.secrets_configured} invalid={!!errors.password} />}
                </Field>
                <Field label={t('admin.sms.sender')} error={errors.sender} hint={t('admin.sms.senderHint', { default: DEFAULT_SENDER })}>{(id) => <Input id={id} value={sender} onChange={(e) => setSender(e.target.value)} maxLength={20} invalid={!!errors.sender} />}</Field>
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 self-end text-[0.9375rem] font-medium text-slate-900">
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t('admin.sms.enabled')}
                </label>
              </div>
              <div><Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>{t('common.save')}</Button></div>
            </form>
          </div>
        </Card>

        <Card title={t('admin.sms.test')}>
          <form className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); setErrors({}); sendTest.mutate(); }}>
            <Field label={t('admin.sms.testPhone')} error={errors.phone} className="flex-1">{(id) => <Input id={id} type="tel" inputMode="tel" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+998 90 123 45 67" invalid={!!errors.phone} />}</Field>
            <Button type="submit" icon={<Send className="h-4 w-4" />} className="sm:mt-[1.625rem]" loading={sendTest.isPending} disabled={!s.enabled || !testPhone.trim()}>{t('admin.sms.test')}</Button>
          </form>
        </Card>
      </div>

      <Card title={t('admin.sms.last14')} padded={false}>
        {stats.isLoading ? <LoadingRows rows={4} /> : stats.isError ? <ErrorState error={stats.error} onRetry={() => stats.refetch()} /> : !stats.data!.days.length ? <EmptyState compact title={t('admin.sms.empty')} /> : (
          <>
            <Table>
              <thead><tr><Th>{t('admin.sms.colDay')}</Th><Th right>{t('admin.sms.colSent')}</Th><Th right>{t('admin.sms.colDelivered')}</Th><Th right>{t('admin.sms.colFailed')}</Th></tr></thead>
              <tbody>{stats.data!.days.map((d) => (
                <tr key={d.day}>
                  <Td className="whitespace-nowrap text-slate-900">{fmtDate(d.day)}</Td>
                  <Td right className="tabular-nums font-semibold text-slate-900">{d.sent}</Td>
                  <Td right className="tabular-nums text-slate-700">{d.delivered}</Td>
                  <Td right className={d.failed ? 'tabular-nums font-semibold text-red-700' : 'tabular-nums text-slate-700'}>{d.failed}</Td>
                </tr>
              ))}</tbody>
            </Table>
            {stats.data!.totals.pending > 0 && <p className="px-5 py-3 text-[0.8125rem] text-slate-600">{t('admin.sms.pending', { n: stats.data!.totals.pending })}</p>}
          </>
        )}
      </Card>
    </div>
  );
}
