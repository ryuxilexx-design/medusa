'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MinusCircle, Pencil, RotateCcw, Search } from 'lucide-react';
import { ROLE_LABEL, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, formatSom, parseSomToTiyin } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { TelegramSettings } from '@/components/telegram-settings';
import { AiSettings } from '@/components/ai-settings';
import { MoneyInput } from '@/components/money-input';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, PageHeader, Pagination, Select, Table, Tabs, Td, Th, Toolbar, useToast } from '@/components/ui';

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
      {tab === 'clinic' && <Clinic />}
      {tab === 'services' && <Services />}
      {tab === 'telegram' && <TelegramSettings />}
      {tab === 'ai' && <AiSettings />}
      {tab === 'audit' && <Audit />}
      {tab === 'demo' && me.demo && <Demo />}
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
  const m = useMutation({ mutationFn: () => api('/settings/clinic', { method: 'PATCH', body: { name: name.trim() } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['settings'] }); toast.success(t('admin.set.clinicSaved')); }, onError: (e) => toast.error(e) });
  if (s.isLoading) return <Card><LoadingRows rows={3} /></Card>;
  if (s.isError) return <Card><ErrorState error={s.error} onRetry={() => s.refetch()} /></Card>;
  const branchName = (id: string) => b.data?.find((x) => x.id === id)?.name;
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
        <Card title={t('admin.set.clinic')}>
          <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name !== s.data?.name) m.mutate(); }}>
            <Field label={t('admin.set.clinicName')}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
            <div><Button type="submit" variant="primary" disabled={!name.trim() || name === s.data?.name} loading={m.isPending}>{t('common.save')}</Button></div>
          </form>
        </Card>
        <Card title={t('admin.set.branches')} padded={false}>
          {b.isLoading ? <LoadingRows rows={2} /> : b.isError ? <ErrorState error={b.error} onRetry={() => b.refetch()} /> : (
            <ul className="divide-y divide-slate-100">{b.data!.map((x) => (
              <li key={x.id} className="px-5 py-3"><div className="font-semibold text-slate-900">{x.name}</div>{x.address && <div className="text-sm text-slate-600">{x.address}</div>}</li>
            ))}</ul>
          )}
        </Card>
      </div>
      <Card title={t('admin.set.rooms')} padded={false}>
        {rooms.isLoading ? <LoadingRows rows={4} /> : rooms.isError ? <ErrorState error={rooms.error} onRetry={() => rooms.refetch()} /> : !rooms.data!.length ? <EmptyState compact title={t('admin.set.noRooms')} /> : (
          <Table>
            <thead><tr><Th>{t('admin.set.colRoom')}</Th><Th>{t('admin.set.colPurpose')}</Th><Th className="hidden sm:table-cell">{t('admin.set.colBranch')}</Th></tr></thead>
            <tbody>{rooms.data!.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium text-slate-900">{r.name}</Td>
                <Td className="text-slate-700">{r.purpose}<div className="text-[0.8125rem] text-slate-600 sm:hidden">{r.branch_name ?? branchName(r.branch_id)}</div></Td>
                <Td className="hidden whitespace-nowrap text-slate-700 sm:table-cell">{r.branch_name ?? branchName(r.branch_id)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Services() {
  const t = useT();
  const q = useQuery({ queryKey: ['services', 'all'], queryFn: () => api('/services?active=all').then((r) => r.data as any[]) });
  const [edit, setEdit] = useState<any>(null);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((s) => !term || s.name.toLowerCase().includes(term) || String(s.code).toLowerCase().includes(term));
  return (
    <Card padded={false}>
      <Toolbar>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <Input type="search" aria-label={t('admin.set.searchService')} placeholder={t('admin.set.searchService')} className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Toolbar>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState compact title={t('admin.set.noServices')} /> : (
        <Table>
          <thead><tr>
            <Th className="hidden sm:table-cell">{t('admin.set.colCode')}</Th><Th>{t('admin.set.colService')}</Th><Th className="hidden lg:table-cell">{t('admin.set.colType')}</Th>
            <Th right>{t('admin.set.colPrice')}</Th><Th right className="hidden md:table-cell">{t('admin.set.colDuration')}</Th><Th right className="hidden lg:table-cell">{t('admin.set.colShare')}</Th>
            <Th className="hidden sm:table-cell">{t('admin.set.colStatus')}</Th><Th right><span className="sr-only">{t('admin.set.colActions')}</span></Th>
          </tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEdit(s)}>
              <Td className="hidden whitespace-nowrap tabular-nums text-slate-600 sm:table-cell">{s.code}</Td>
              <Td className="min-w-[11rem]"><span className="font-semibold text-slate-900">{s.name}</span>
                {!s.active && <div className="text-[0.8125rem] text-slate-600 sm:hidden">{t('admin.set.inactive')}</div>}</Td>
              <Td className="hidden whitespace-nowrap text-slate-700 lg:table-cell">{t(`service.${s.category}` as MessageKey)}</Td>
              <Td right className="font-medium text-slate-900">{formatSom(s.price)}</Td>
              <Td right className="hidden text-slate-700 md:table-cell">{t('admin.set.minutes', { n: s.duration_min })}</Td>
              <Td right className="hidden text-slate-700 lg:table-cell">{Number(s.share_percent)}%</Td>
              <Td className="hidden sm:table-cell">{s.active ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('admin.set.active')}</Badge> : <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.set.inactive')}</Badge>}</Td>
              <Td right><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={(e) => { e.stopPropagation(); setEdit(s); }} aria-label={`${t('admin.set.edit')}: ${s.name}`}><span className="hidden md:inline">{t('admin.set.edit')}</span></Button></Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {edit && <ServiceModal s={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

/** Tiyin → the text a person types («150000» or «150000,50»), with integer arithmetic only. */
const tiyinToInput = (tiyin: number) => {
  const cents = tiyin % 100, som = (tiyin - cents) / 100;
  return cents ? `${som},${String(cents).padStart(2, '0')}` : String(som);
};

function ServiceModal({ s, onClose }: { s: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(s.name);
  const [price, setPrice] = useState(tiyinToInput(Number(s.price)));
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
  const dirty = name !== s.name || p !== Number(s.price) || Number(dur) !== s.duration_min || active !== s.active;
  return (
    <Modal open onClose={onClose} dirty={dirty} title={t('admin.set.serviceTitle', { code: s.code })} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!dirty} loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('admin.set.serviceName')} required className="sm:col-span-2" error={err.name ?? local.name}>{(id) => <Input id={id} value={name} invalid={!!(err.name ?? local.name)} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t('admin.set.price')} required error={err.price ?? local.price} hint={t('admin.set.priceHint')}>{(id) => <MoneyInput id={id} value={price} invalid={!!(err.price ?? local.price)} onChange={(e) => setPrice(e.target.value)} />}</Field>
        <Field label={t('admin.set.duration')} required error={err.duration_min ?? local.duration_min}>{(id) => <Input id={id} type="number" min={5} max={240} value={dur} invalid={!!(err.duration_min ?? local.duration_min)} onChange={(e) => setDur(e.target.value)} />}</Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] font-medium text-slate-900 sm:col-span-2"><input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('admin.set.activeCheck')}</label>
      </div>
    </Modal>
  );
}

/** Action groups for the filter: the API filters by an action-code prefix (`?action=payment.`). */
const AUDIT_GROUPS = ['appointment.', 'patient.', 'order.', 'payment.', 'refund.', 'invoice.', 'cash_shift.', 'expense.', 'clinical_note.', 'diagnostic_report.', 'lab', 'document.', 'inventory.', 'staff.', 'doctor.', 'auth.', 'service.', 'settings.', 'telegram.', 'ai.', 'demo.'] as const;
const groupKey = (g: string) => `admin.auditGroup.${g.replace(/\.$/, '')}` as MessageKey;

function Audit() {
  const t = useT();
  const { me } = useSession();
  const groups = AUDIT_GROUPS.filter((g) => me.demo || g !== 'demo.');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['audit', page, action], queryFn: () => api(`/audit?page=${page}&page_size=20${action ? `&action=${encodeURIComponent(action)}` : ''}`), placeholderData: (p) => p });
  const label = (code: string) => { const k = `admin.audit.${code}` as MessageKey; const s = t(k); return s === k ? code : s; };
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
                <Td className="sm:min-w-[10rem]"><div className="font-medium text-slate-900" title={a.action}>{label(a.action)}</div><div className="text-[0.8125rem] text-slate-600 md:hidden">{a.summary}</div></Td>
                <Td className="hidden min-w-[14rem] max-w-[32rem] break-words text-slate-700 md:table-cell">{a.summary}</Td>
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
