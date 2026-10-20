'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MinusCircle, Pencil, RotateCcw } from 'lucide-react';
import { ROLE_LABEL, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, formatSom, parseSomToTiyin } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { TelegramSettings } from '@/components/telegram-settings';
import { AiSettings } from '@/components/ai-settings';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, PageHeader, Pagination, Select, Table, Tabs, Td, Th, useToast } from '@/components/ui';

type Tab = 'clinic' | 'services' | 'telegram' | 'ai' | 'audit' | 'demo';

export default function SettingsPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('clinic');
  return (
    <>
      <PageHeader title={t('admin.set.title')} subtitle={t('admin.set.subtitle')} />
      <Card padded={false}>
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} items={[{ value: 'clinic', label: t('admin.set.tabClinic') }, { value: 'services', label: t('admin.set.tabServices') }, { value: 'telegram', label: t('admin.set.tabTelegram') }, { value: 'ai', label: t('admin.set.tabAi') }, { value: 'audit', label: t('admin.set.tabAudit') }, { value: 'demo', label: t('admin.set.tabDemo') }]} /></div>
        <div className="p-4">
          {tab === 'clinic' && <Clinic />}
          {tab === 'services' && <Services />}
          {tab === 'telegram' && <TelegramSettings />}
          {tab === 'ai' && <AiSettings />}
          {tab === 'audit' && <Audit />}
          {tab === 'demo' && <Demo />}
        </div>
      </Card>
    </>
  );
}

function Clinic() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings').then((r) => r.data) });
  const b = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches').then((r) => r.data as any[]) });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api('/rooms').then((r) => r.data as any[]) });
  const [name, setName] = useState('');
  useEffect(() => { if (s.data) setName(s.data.name); }, [s.data]);
  const m = useMutation({ mutationFn: () => api('/settings/clinic', { method: 'PATCH', body: { name } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['settings'] }); toast.success(t('admin.set.clinicSaved')); }, onError: (e) => toast.error(e) });
  if (s.isLoading) return <LoadingRows rows={3} />;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <Field label={t('admin.set.clinicName')} hint={t('admin.set.clinicNameHint')}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Button variant="primary" disabled={!name.trim() || name === s.data?.name} loading={m.isPending} onClick={() => m.mutate()}>{t('common.save')}</Button>
        <h3 className="pt-4 text-sm font-semibold text-slate-800">{t('admin.set.branches')}</h3>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm">{b.data?.map((x) => <li key={x.id} className="px-3 py-2"><div className="font-semibold text-slate-900">{x.name}</div>{x.address && <div className="text-slate-600">{x.address}</div>}</li>)}</ul>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">{t('admin.set.rooms')}</h3>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm">{rooms.data?.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-x-3 px-3 py-2"><span>{r.name}, {r.purpose}</span><span className="text-slate-600">{r.branch_name}</span></li>)}</ul>
        <p className="mt-3 text-[0.8125rem] text-slate-600">{t('admin.set.nextRelease')}</p>
      </div>
    </div>
  );
}

function Services() {
  const t = useT();
  const q = useQuery({ queryKey: ['services', 'all'], queryFn: () => api('/services?active=all').then((r) => r.data as any[]) });
  const [edit, setEdit] = useState<any>(null);
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <Alert tone="blue">{t('admin.set.priceNote')}</Alert>
      <Table className="mt-3">
        <thead><tr><Th>{t('admin.set.colCode')}</Th><Th>{t('admin.set.colService')}</Th><Th>{t('admin.set.colType')}</Th><Th right>{t('admin.set.colPrice')}</Th><Th right>{t('admin.set.colDuration')}</Th><Th right>{t('admin.set.colShare')}</Th><Th>{t('admin.set.colStatus')}</Th><Th right /></tr></thead>
        <tbody>{q.data!.map((s) => (
          <tr key={s.id} className="hover:bg-slate-50">
            <Td className="tabular-nums text-slate-600">{s.code}</Td><Td className="min-w-[12rem] font-medium">{s.name}</Td><Td><Badge>{t(`service.${s.category}` as MessageKey)}</Badge></Td>
            <Td right>{formatSom(s.price)}</Td><Td right className="whitespace-nowrap">{t('admin.set.minutes', { n: s.duration_min })}</Td><Td right>{Number(s.share_percent)}</Td>
            <Td>{s.active ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('admin.set.active')}</Badge> : <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.set.inactive')}</Badge>}</Td>
            <Td right><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(s)} aria-label={`${t('admin.set.edit')}: ${s.name}`}>{t('admin.set.edit')}</Button></Td>
          </tr>
        ))}</tbody>
      </Table>
      {edit && <ServiceModal s={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ServiceModal({ s, onClose }: { s: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(s.name);
  const [price, setPrice] = useState(String(s.price / 100));
  const [dur, setDur] = useState(String(s.duration_min));
  const [active, setActive] = useState<boolean>(s.active);
  const [err, setErr] = useState<Record<string, string>>({});
  const p = parseSomToTiyin(price);
  const d = Number(dur);
  const local = { name: !name.trim() ? t('admin.set.errName') : undefined, price: p == null ? t('admin.set.badAmount') : undefined, duration_min: !Number.isInteger(d) || d < 5 || d > 240 ? t('admin.set.badDuration') : undefined };
  const save = () => { if (local.name || local.price || local.duration_min) return; m.mutate(); };
  const m = useMutation({
    mutationFn: () => api(`/services/${s.id}`, { method: 'PATCH', body: { name, price: p, duration_min: Number(dur), active } }),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['services'] }); toast.success(r.data.changes.length ? t('admin.set.savedChanges', { changes: r.data.changes.join(', ') }) : t('admin.set.noChanges')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const dirty = name !== s.name || p !== s.price || Number(dur) !== s.duration_min || active !== s.active;
  return (
    <Modal open onClose={onClose} dirty={dirty} title={t('admin.set.serviceTitle', { code: s.code })} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!dirty} loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('admin.set.serviceName')} required className="sm:col-span-2" error={err.name ?? local.name}>{(id) => <Input id={id} value={name} invalid={!!(err.name ?? local.name)} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t('admin.set.price')} required error={err.price ?? local.price}>{(id) => <Input id={id} inputMode="decimal" value={price} invalid={!!(err.price ?? local.price)} onChange={(e) => setPrice(e.target.value)} />}</Field>
        <Field label={t('admin.set.duration')} required error={err.duration_min ?? local.duration_min}>{(id) => <Input id={id} type="number" min={5} max={240} value={dur} invalid={!!(err.duration_min ?? local.duration_min)} onChange={(e) => setDur(e.target.value)} />}</Field>
        <label className="flex min-h-11 sm:col-span-2 cursor-pointer items-center gap-2 text-[0.9375rem]"><input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('admin.set.activeCheck')}</label>
      </div>
    </Modal>
  );
}

/** Action groups for the filter: the API filters by an action-code prefix (`?action=payment.`). */
const AUDIT_GROUPS = ['appointment.', 'patient.', 'order.', 'payment.', 'refund.', 'invoice.', 'cash_shift.', 'expense.', 'clinical_note.', 'diagnostic_report.', 'lab', 'document.', 'inventory.', 'staff.', 'doctor.', 'auth.', 'service.', 'settings.', 'telegram.', 'ai.', 'demo.'] as const;
const groupKey = (g: string) => `admin.auditGroup.${g.replace(/\.$/, '')}` as MessageKey;

function Audit() {
  const t = useT();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['audit', page, action], queryFn: () => api(`/audit?page=${page}&page_size=20${action ? `&action=${encodeURIComponent(action)}` : ''}`), placeholderData: (p) => p });
  const label = (code: string) => { const k = `admin.audit.${code}` as MessageKey; const s = t(k); return s === k ? code : s; };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label={t('admin.audit.filterAction')} className="w-full sm:w-72">
          {(id) => <Select id={id} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">{t('admin.audit.allActions')}</option>
            {AUDIT_GROUPS.map((g) => <option key={g} value={g}>{t(groupKey(g))}</option>)}
          </Select>}
        </Field>
      </div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState title={t('admin.audit.empty')} /> : (
        <>
          <Table>
            <thead><tr><Th>{t('admin.set.colTime')}</Th><Th>{t('admin.set.colActor')}</Th><Th>{t('admin.set.colAction')}</Th><Th>{t('admin.set.colDetail')}</Th></tr></thead>
            <tbody>{q.data.data.map((a: any) => (
              <tr key={a.id} className="align-top">
                <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(a.occurred_at)}</Td>
                <Td className="min-w-[10rem]"><div>{a.actor_name}</div>{a.actor_role in ROLE_LABEL && <div className="text-[0.8125rem] text-slate-600">{t(`role.${a.actor_role}` as MessageKey)}</div>}</Td>
                <Td className="min-w-[10rem]"><div className="font-medium text-slate-900">{label(a.action)}</div><div className="font-mono text-xs text-slate-600">{a.action}</div></Td>
                <Td className="min-w-[14rem] max-w-[32rem] break-words text-slate-700">{a.summary}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
        </>
      )}
      <p className="mt-2 text-[0.8125rem] text-slate-600">{t('admin.set.auditNote')} {t('admin.audit.storedNote')}</p>
    </>
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
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-slate-700">{t('admin.set.demoDate')} <b className="whitespace-nowrap">{fmtDate(me.today)}</b>. {t('admin.set.demoTextRest')}</p>
      <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm(true)}>{t('admin.set.resetButton')}</Button>
      <Modal open={confirm} onClose={() => !m.isPending && setConfirm(false)} title={t('admin.set.resetButton')}
        footer={<><Button onClick={() => setConfirm(false)} disabled={m.isPending}>{t('common.cancel')}</Button><Button variant="danger" disabled={typed.trim().toUpperCase() !== 'TIKLASH'} loading={m.isPending} onClick={() => m.mutate()}>{t('admin.set.reset')}</Button></>}>
        <Alert tone="red" title={t('admin.set.resetWarnTitle')}>{t('admin.set.resetWarnText')}</Alert>
        <Field label={t('admin.set.typeToConfirm', { word: 'TIKLASH' })} className="mt-3">{(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}</Field>
      </Modal>
    </div>
  );
}
