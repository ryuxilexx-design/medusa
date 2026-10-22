'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { ROLE_LABEL, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useI18n, useT } from '@/lib/i18n';
import { TelegramSettings } from '@/components/telegram-settings';
import { ClinicSettings, ServicesSettings } from '@/components/catalog-settings';
import { AiSettings } from '@/components/ai-settings';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, PageHeader, Pagination, Select, Table, Tabs, Td, Th, Toolbar, useToast } from '@/components/ui';

type Tab = 'clinic' | 'services' | 'telegram' | 'ai' | 'audit' | 'demo';

export default function SettingsPage() {
  const t = useT();
  const { me } = useSession();
  const [tab, setTab] = useState<Tab>('clinic');
  // a real clinic (production) has no demo data to reset: no demo tab
  const tabs: { value: Tab; label: string }[] = [{ value: 'clinic', label: t('admin.set.tabClinic') }, { value: 'services', label: t('admin.set.tabServices') }, { value: 'telegram', label: t('admin.set.tabTelegram') }, { value: 'ai', label: t('admin.set.tabAi') }, { value: 'audit', label: t('admin.set.tabAudit') }];
  if (me.demo) tabs.push({ value: 'demo', label: t('admin.set.tabDemo') });
  return (
    <>
      <PageHeader title={t('admin.set.title')} />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} items={tabs} /></div>
      {tab === 'clinic' && <ClinicSettings />}
      {tab === 'services' && <ServicesSettings />}
      {tab === 'telegram' && <TelegramSettings />}
      {tab === 'ai' && <AiSettings />}
      {tab === 'audit' && <Audit />}
      {tab === 'demo' && me.demo && <Demo />}
    </>
  );
}

/** Action groups for the filter: the API filters by an action-code prefix (`?action=payment.`). */
const AUDIT_GROUPS = ['appointment.', 'patient.', 'order.', 'payment.', 'refund.', 'invoice.', 'cash_shift.', 'expense.', 'clinical_note.', 'diagnostic_report.', 'lab', 'document.', 'inventory.', 'staff.', 'doctor.', 'auth.', 'service.', 'room.', 'branch.', 'settings.', 'telegram.', 'camera.', 'ai.', 'demo.'] as const;
const groupKey = (g: string) => `admin.auditGroup.${g.replace(/\.$/, '')}` as MessageKey;

function Audit() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const groups = AUDIT_GROUPS.filter((g) => me.demo || g !== 'demo.');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['audit', page, action], queryFn: () => api(`/audit?page=${page}&page_size=20${action ? `&action=${encodeURIComponent(action)}` : ''}`), placeholderData: (p) => p });
  // the action is always shown as a label in the person's language (an unknown code falls back to its group's name)
  const label = (code: string) => {
    const k = `admin.audit.${code}` as MessageKey; const s = t(k);
    if (s !== k) return s;
    const g = AUDIT_GROUPS.find((x) => code.startsWith(x));
    return g ? t(groupKey(g)) : code;
  };
  return (
    <Card padded={false}>
      <Toolbar>
        <Select aria-label={t('admin.audit.filterAction')} className="w-full sm:w-72" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">{t('admin.audit.allActions')}</option>
          {groups.map((g) => <option key={g} value={g}>{t(groupKey(g))}</option>)}
        </Select>
      </Toolbar>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('admin.audit.empty')} /> : (
        <>
          <Table>
            <thead><tr><Th>{t('admin.set.colTime')}</Th><Th className="hidden sm:table-cell">{t('admin.set.colActor')}</Th><Th>{t('admin.set.colAction')}</Th><Th className="hidden md:table-cell">{t('admin.set.colDetail')}</Th></tr></thead>
            <tbody>{q.data.data.map((a: any) => (
              <tr key={a.id} className="align-top">
                <Td className="tabular-nums text-slate-700"><div className="whitespace-nowrap">{fmtDateTime(a.occurred_at)}</div><div className="font-medium text-slate-900 sm:hidden">{a.actor_name}</div></Td>
                <Td className="hidden min-w-[9rem] sm:table-cell"><div className="font-medium text-slate-900">{a.actor_name}</div>{a.actor_role in ROLE_LABEL && <div className="text-[0.8125rem] text-slate-600">{t(`role.${a.actor_role}` as MessageKey)}</div>}</Td>
                <Td className="sm:min-w-[10rem]"><div className="font-medium text-slate-900">{label(a.action)}</div><div lang="uz-Latn" className="text-[0.8125rem] text-slate-600 md:hidden">{a.summary}</div></Td>
                {/* the stored detail is a server-written Uzbek line (data, not interface text): marked as such for screen readers */}
                <Td className="hidden min-w-[14rem] max-w-[32rem] break-words text-slate-700 md:table-cell"><span lang="uz-Latn" title={locale === 'uz' ? undefined : t('admin.audit.detailLang')}>{a.summary}</span></Td>
              </tr>
            ))}</tbody>
          </Table>
          <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function Demo() {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const m = useMutation({
    mutationFn: () => api('/demo/reset', { method: 'POST' }),
    onSuccess: () => { qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' }); qc.invalidateQueries({ queryKey: ['me'] }); setConfirm(false); setTyped(''); toast.success(t('admin.set.resetDone')); },
    onError: (e) => toast.error(e),
  });
  return (
    <Card title={t('admin.set.resetButton')} className="max-w-2xl">
      <div className="flex flex-col items-start gap-4">
        <p className="text-[0.9375rem] text-slate-700">{t('admin.set.demoDate')} <b className="whitespace-nowrap text-slate-900">{fmtDate(me.today)}</b></p>
        <p className="text-[0.9375rem] text-slate-700">{t('admin.set.demoTextRest')}</p>
        <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm(true)}>{t('admin.set.resetButton')}</Button>
      </div>
      <Modal open={confirm} onClose={() => !m.isPending && setConfirm(false)} title={t('admin.set.resetButton')}
        footer={<><Button onClick={() => setConfirm(false)} disabled={m.isPending}>{t('common.cancel')}</Button><Button variant="danger" disabled={typed.trim().toUpperCase() !== 'TIKLASH'} loading={m.isPending} onClick={() => m.mutate()}>{t('admin.set.reset')}</Button></>}>
        <Alert tone="red" title={t('admin.set.resetWarnTitle')}>{t('admin.set.resetWarnText')}</Alert>
        <Field label={t('admin.set.typeToConfirm', { word: 'TIKLASH' })} className="mt-4">{(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}</Field>
      </Modal>
    </Card>
  );
}
