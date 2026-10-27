'use client';
// «Hamkorlar»: referral partners — what each earned on the services of the patients they sent, what was paid, what is
// left — the partner directory, the payouts, and the lead-source report (docs/REFERRALS.md). Manager only.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Banknote, HandCoins, Handshake, ListChecks, Pencil, Plus, Scale, Search, Wallet } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime, formatPhone, formatSom } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, PageHeader, Pagination, Select, StatCard, Table, Tabs, Td, Th, Toolbar, useToast } from '@/components/ui';
import { CsvLink, FootRow, PeriodPicker, StatRow } from '@/components/finance-extra';
import { StatMoney } from '@/components/cash-shift';
import { type LeadSource, PartnerFormModal, PartnerLinesModal, PayoutModal } from '@/components/referrals';

type Tab = 'report' | 'directory' | 'payouts' | 'sources';
const TABS: Tab[] = ['report', 'directory', 'payouts', 'sources'];

export default function PartnersPage() { return <Suspense><Partners /></Suspense>; }

function Partners() {
  const t = useT();
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(TABS.includes(sp.get('tab') as Tab) ? (sp.get('tab') as Tab) : 'report');
  const [from, setFrom] = useState(sp.get('from') ?? me.today.slice(0, 8) + '01');
  const [to, setTo] = useState(sp.get('to') ?? me.today);
  const [adding, setAdding] = useState(false);
  const period = <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />;
  return (
    <>
      <PageHeader title={t('ref.title')} subtitle={t('ref.subtitle')}
        actions={<Button variant="primary" icon={<Plus className="h-5 w-5" />} onClick={() => setAdding(true)}>{t('ref.addPartner')}</Button>} />
      {tab === 'report' && <ReportStats from={from} to={to} branchId={branchId} />}
      <Card padded={false}>
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} label={t('ref.title')} items={[
          { value: 'report', label: t('ref.tab.report') }, { value: 'directory', label: t('ref.tab.directory') }, { value: 'payouts', label: t('ref.tab.payouts') }, { value: 'sources', label: t('ref.tab.sources') },
        ]} /></div>
        {tab === 'report' && <ReportTab from={from} to={to} branchId={branchId} period={period} />}
        {tab === 'directory' && <DirectoryTab />}
        {tab === 'payouts' && <PayoutsTab from={from} to={to} branchId={branchId} period={period} />}
        {tab === 'sources' && <SourcesTab from={from} to={to} branchId={branchId} period={period} />}
      </Card>
      {adding && <PartnerFormModal onClose={() => setAdding(false)} />}
    </>
  );
}

const useReport = (from: string, to: string, branchId: string) =>
  useQuery({ queryKey: ['reports', 'referrals', from, to, branchId], queryFn: () => api(`/reports/referrals${qs({ from, to, branch_id: branchId })}`) });

function ReportStats({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const t = useT();
  const q = useReport(from, to, branchId);
  const s = q.data?.meta.totals;
  if (q.isError) return null;
  return (
    <StatRow label={t('ref.title')}>
      <StatCard icon={<Handshake />} label={t('ref.statNet')} loading={!s} value={s && <StatMoney tiyin={s.net} />} sub={s && t('ref.statVisits', { visits: s.visits, patients: s.patients })} />
      <StatCard icon={<HandCoins />} label={t('ref.statDue')} loading={!s} value={s && <StatMoney tiyin={s.due} />} sub={t('ref.statDueSub')} />
      <StatCard icon={<Wallet />} label={t('ref.statPaid')} loading={!s} value={s && <StatMoney tiyin={s.paid} />} sub={t('ref.statPaidSub')} />
      <StatCard icon={<Scale />} label={t('ref.statBalance')} loading={!s} tone={s?.balance ? 'danger' : 'default'} value={s && <StatMoney tiyin={s.balance} />} sub={t('ref.statBalanceSub')} />
    </StatRow>
  );
}

function ReportTab({ from, to, branchId, period }: { from: string; to: string; branchId: string; period: React.ReactNode }) {
  const t = useT();
  const q = useReport(from, to, branchId);
  const [paying, setPaying] = useState<any>(null);
  const [lines, setLines] = useState<any>(null);
  return (<>
    <Toolbar actions={<CsvLink href={`/api/v1/reports/referrals/export.csv${qs({ from, to, branch_id: branchId })}`} />}>{period}</Toolbar>
    {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('ref.noReport')} /> : (
      <Table>
        <thead><tr><Th>{t('ref.partner')}</Th><Th right className="hidden 2xl:table-cell">{t('ref.colVisits')}</Th><Th right className="hidden lg:table-cell">{t('ref.colNet')}</Th><Th right className="hidden sm:table-cell">{t('ref.colDue')}</Th><Th right className="hidden sm:table-cell">{t('ref.colPaid')}</Th><Th right className="hidden sm:table-cell">{t('ref.colBalance')}</Th><Th /></tr></thead>
        <tbody>{q.data.data.map((r: any) => (
          <tr key={r.partner_id} className="group hover:bg-slate-50" data-partner={r.code}>
            <Td className="min-w-[10rem]"><div className="font-semibold text-slate-900">{r.full_name}</div>
              <div className="text-small text-slate-600">{t('ref.codeShort', { code: r.code })} · {t(`ref.kind.${r.kind}` as MessageKey)}{r.default_percent ? ` · ${r.default_percent}%` : ''}</div>
              <div className="text-small text-slate-600 sm:hidden">{t('ref.colDue')}: <span className="tabular-nums font-semibold text-slate-900">{formatSom(r.due)}</span></div>
              <div className="text-small text-slate-600 sm:hidden">{t('ref.colBalance')}: <span className={cx('tabular-nums', r.balance > 0 && 'font-semibold text-red-700')}>{formatSom(r.balance)}</span></div></Td>
            <Td right className="hidden whitespace-nowrap tabular-nums 2xl:table-cell">{r.visits}<div className="text-small text-slate-600">{t('ref.nPatients', { n: r.patients })}</div></Td>
            <Td right className="hidden lg:table-cell">{formatSom(r.net)}{r.visits > 0 && <div className="text-small text-slate-600 2xl:hidden">{t('ref.statVisits', { visits: r.visits, patients: r.patients })}</div>}</Td>
            <Td right className="hidden font-semibold text-slate-900 sm:table-cell">{formatSom(r.due)}</Td>
            <Td right className="hidden sm:table-cell">{formatSom(r.paid)}</Td>
            <Td right className={cx('hidden sm:table-cell', r.balance > 0 ? 'font-semibold text-red-700' : 'text-slate-600')}>{formatSom(r.balance)}</Td>
            <Td right className="!pl-1">
              <div className="flex flex-nowrap items-center justify-end gap-1">
                {r.services > 0 && <Button size="icon" variant="ghost" onClick={() => setLines(r)} aria-label={t('ref.details')} title={t('ref.details')} data-testid="partner-lines"><ListChecks className="h-5 w-5" /></Button>}
                {r.balance > 0 && <Button size="sm" icon={<Banknote className="h-4 w-4" />} onClick={() => setPaying(r)} aria-label={`${t('ref.pay')}: ${r.full_name}`} title={t('ref.pay')}><span className="sr-only 2xl:not-sr-only">{t('ref.pay')}</span></Button>}
              </div>
            </Td>
          </tr>
        ))}</tbody>
        <tfoot><FootRow cells={[{ left: true, value: t('ref.nPartners', { n: q.data.data.length }) }, { className: 'hidden 2xl:table-cell', value: q.data.meta.totals.visits }, { className: 'hidden lg:table-cell', value: formatSom(q.data.meta.totals.net) },
          { className: 'hidden sm:table-cell', value: formatSom(q.data.meta.totals.due) }, { className: 'hidden sm:table-cell', value: formatSom(q.data.meta.totals.paid) }, { className: 'hidden sm:table-cell text-red-700', value: formatSom(q.data.meta.totals.balance) }, {}]} /></tfoot>
      </Table>
    )}
    {paying && <PayoutModal partner={paying} onClose={() => setPaying(null)} />}
    {lines && <PartnerLinesModal partner={lines} from={from} to={to} branchId={branchId} onClose={() => setLines(null)} />}
  </>);
}

function DirectoryTab() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('1');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any>(null);
  const ds = useDebounced(search.trim(), 300);
  useEffect(() => setPage(1), [ds, active]);
  const q = useQuery({ queryKey: ['referral-partners', 'directory', ds, active, page], queryFn: () => api(`/referral-partners${qs({ search: ds, active, page, page_size: 20 })}`), placeholderData: (p) => p });
  return (<>
    <Toolbar>
      <div className="relative w-full sm:w-[22rem]"><Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" /><Input className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('ref.searchPlaceholder')} aria-label={t('cash.search')} /></div>
      <Select aria-label={t('registrar.status')} className="w-full sm:w-auto" value={active} onChange={(e) => setActive(e.target.value)}>
        <option value="1">{t('ref.filterActive')}</option><option value="0">{t('ref.filterInactive')}</option><option value="">{t('ref.filterAll')}</option>
      </Select>
    </Toolbar>
    {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('ref.notFound')} /> : <>
      <Table>
        <thead><tr><Th>{t('ref.partner')}</Th><Th className="hidden md:table-cell">{t('ref.workplace')}</Th><Th className="hidden sm:table-cell">{t('registrar.phone')}</Th><Th right>{t('ref.percent')}</Th><Th className="right-0 z-10" /></tr></thead>
        <tbody>{q.data.data.map((p: any) => (
          <tr key={p.id} className={cx('group hover:bg-slate-50', !p.active && 'text-slate-600')}>
            <Td className="min-w-[10rem]"><div className="font-semibold text-slate-900">{p.full_name}</div>
              <div className="text-small text-slate-600">{t('ref.codeShort', { code: p.code })} · {t(`ref.kind.${p.kind}` as MessageKey)}{p.specialty ? ` · ${p.specialty}` : ''}</div>
              {!p.active && <Badge className="mt-1">{t('ref.inactive')}</Badge>}
              <div className="text-small text-slate-600 md:hidden">{p.workplace}</div></Td>
            <Td className="hidden min-w-[10rem] md:table-cell">{p.workplace ?? '—'}{p.region && <div className="text-small text-slate-600">{p.region}</div>}</Td>
            <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{p.phone ? formatPhone(p.phone) : '—'}</Td>
            <Td right className="tabular-nums">{p.default_percent ? `${p.default_percent}%` : <span className="text-amber-800">{t('ref.noPercent')}</span>}</Td>
            <Td right className="!pl-1 sm:sticky sm:right-0 sm:bg-white sm:group-hover:bg-slate-50"><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(p)} aria-label={t('registrar.edit')}><span className="sr-only lg:not-sr-only">{t('registrar.edit')}</span></Button></Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
    </>}
    {editing && <PartnerFormModal partner={editing} onClose={() => setEditing(null)} />}
  </>);
}

function PayoutsTab({ from, to, branchId, period }: { from: string; to: string; branchId: string; period: React.ReactNode }) {
  const t = useT();
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<any>(null);
  useEffect(() => setPage(1), [from, to, branchId]);
  const q = useQuery({ queryKey: ['referral-payouts', from, to, branchId, page], queryFn: () => api(`/referral-payouts${qs({ from, to, branch_id: branchId, page, page_size: 20 })}`), placeholderData: (p) => p });
  return (<>
    <Toolbar>{period}</Toolbar>
    {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('ref.noPayouts')} /> : <>
      <Table>
        <thead><tr><Th className="hidden sm:table-cell">{t('cash.colTime')}</Th><Th>{t('ref.partner')}</Th><Th className="hidden md:table-cell">{t('ref.method')}</Th><Th right>{t('cash.colSum')}</Th><Th className="right-0 z-10" /></tr></thead>
        <tbody>{q.data.data.map((p: any) => (
          <tr key={p.id} className={cx('group hover:bg-slate-50', p.status === 'void' && 'text-slate-600')}>
            <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{fmtDateTime(p.paid_at)}<div className="text-small text-slate-600">{p.created_by_name}</div></Td>
            <Td className="min-w-[10rem]"><div className="font-medium text-slate-900">{p.partner_name}</div><div className="text-small text-slate-600">{t('ref.codeShort', { code: p.partner_code })}{p.note ? ` · ${p.note}` : ''}</div>
              <div className="text-small tabular-nums text-slate-600 sm:hidden">{fmtDateTime(p.paid_at)}</div>
              {p.status === 'void' && <div className="mt-1"><Badge icon={<Ban className="h-3.5 w-3.5" />}>{t('ref.voided')}</Badge><span className="ml-2 text-small">{p.void_reason}</span></div>}</Td>
            <Td className="hidden md:table-cell">{p.method === 'cash' ? t('ref.cashFromDrawer') : t('payment.transfer')}{p.shift_number && <div className="text-small text-slate-600">{t('cash.shiftNo', { n: p.shift_number })}</div>}<div className="text-small text-slate-600">{p.branch_name}</div></Td>
            <Td right className={p.status === 'void' ? 'line-through' : 'font-medium'}>{formatSom(p.amount)}</Td>
            <Td right className="!pl-1 sm:sticky sm:right-0 sm:bg-white sm:group-hover:bg-slate-50">
              {p.status === 'active' && (p.shift_status === 'closed' ? <span className="whitespace-nowrap text-small text-slate-600">{t('cash.expenseLockedShort')}</span>
                : <Button size="sm" variant="ghost" className="!text-slate-700 hover:!bg-red-50 hover:!text-red-700" icon={<Ban className="h-4 w-4" />} aria-label={t('ref.voidPayout')} onClick={() => setVoiding(p)}><span className="sr-only xl:not-sr-only">{t('ref.voidPayout')}</span></Button>)}
            </Td>
          </tr>
        ))}</tbody>
        <tfoot><FootRow cells={[{ className: 'hidden sm:table-cell' }, { left: true, value: t('ref.nPayouts', { n: q.data.meta.count }) }, { className: 'hidden md:table-cell' }, { value: formatSom(q.data.meta.total) }, {}]} /></tfoot>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data.meta.count} onPage={setPage} />
    </>}
    {voiding && <VoidPayoutModal payout={voiding} onClose={() => setVoiding(null)} />}
  </>);
}

function VoidPayoutModal({ payout, onClose }: { payout: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/referral-payouts/${payout.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { ['referral-payouts', 'reports', 'cash-shifts', 'cash-shift', 'finance-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('ref.payoutVoided')); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open onClose={onClose} dirty={!!reason.trim()} title={t('ref.voidTitle', { name: payout.partner_name, amount: formatSom(payout.amount) })}
      footer={<><ModalCancel>{t('common.back')}</ModalCancel><Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>{t('ref.voidPayout')}</Button></>}>
      <Field label={t('cash.colReason')} required>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('ref.voidPlaceholder')} />}</Field>
    </Modal>
  );
}

function SourcesTab({ from, to, branchId, period }: { from: string; to: string; branchId: string; period: React.ReactNode }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['reports', 'lead-sources', from, to, branchId], queryFn: () => api(`/reports/lead-sources${qs({ from, to, branch_id: branchId })}`) });
  const pct = (v: number | null) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);
  return (<>
    <Toolbar actions={<><Button onClick={() => setEditing(true)} icon={<Pencil className="h-4 w-4" />} aria-label={t('ref.editSources')} title={t('ref.editSources')}><span className="sr-only sm:not-sr-only">{t('ref.editSources')}</span></Button><CsvLink href={`/api/v1/reports/lead-sources/export.csv${qs({ from, to, branch_id: branchId })}`} /></>}>{period}</Toolbar>
    {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
      const rows = q.data.data as any[], tot = q.data.meta.totals;
      if (!rows.some((r) => r.new_patients || r.booked || r.revenue)) return <EmptyState compact title={t('ref.noSourceData')} />;
      return (
        <Table>
          <thead><tr><Th>{t('ref.source')}</Th><Th right className="hidden sm:table-cell">{t('ref.colNewPatients')}</Th><Th right className="hidden sm:table-cell">{t('ref.colCame')}</Th><Th right className="hidden md:table-cell">{t('ref.colConversion')}</Th><Th right>{t('ref.colRevenue')}</Th><Th right className="hidden lg:table-cell">{t('ref.colAvgCheck')}</Th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.source_id ?? 'none'} className="hover:bg-slate-50">
              <Td className="min-w-[9rem]"><div className="font-medium text-slate-900">{r.name ?? t('ref.sourceUnknown')}</div><div className="text-small tabular-nums text-slate-600 sm:hidden">{t('ref.newShort', { n: r.new_patients })} · {t('ref.colCame')}: {t('ref.cameOf', { came: r.came, booked: r.booked })}</div></Td>
              <Td right className="hidden tabular-nums sm:table-cell">{r.new_patients}</Td>
              <Td right className="hidden whitespace-nowrap tabular-nums sm:table-cell">{t('ref.cameOf', { came: r.came, booked: r.booked })}</Td>
              <Td right className="hidden tabular-nums md:table-cell">{pct(r.conversion)}</Td>
              <Td right className="font-medium">{formatSom(r.revenue)}</Td>
              <Td right className="hidden lg:table-cell">{r.checks ? formatSom(r.average_check) : '—'}</Td>
            </tr>
          ))}</tbody>
          <tfoot><FootRow cells={[{ left: true, value: t('clinical.rep.total') }, { className: 'hidden sm:table-cell', value: tot.new_patients }, { className: 'hidden sm:table-cell', value: t('ref.cameOf', { came: tot.came, booked: tot.booked }) }, { className: 'hidden md:table-cell', value: pct(tot.conversion) }, { value: formatSom(tot.revenue) }, { className: 'hidden lg:table-cell', value: tot.checks ? formatSom(tot.average_check) : '—' }]} /></tfoot>
        </Table>
      );
    })()}
    {editing && <SourcesModal onClose={() => setEditing(false)} />}
  </>);
}

/** The lead-source directory: rename, switch off, add (the built-in ones stay on). */
function SourcesModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['lead-sources', 'all'], queryFn: () => api<{ data: LeadSource[] }>('/lead-sources?all=1').then((r) => r.data) });
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ['lead-sources'] }); qc.invalidateQueries({ queryKey: ['reports'] }); };
  const add = useMutation({ mutationFn: () => api('/lead-sources', { method: 'POST', body: { name } }), onSuccess: () => { done(); setName(''); toast.success(t('ref.sourceAdded')); }, onError: (e) => setErr((e as Error).message) });
  const patch = useMutation({ mutationFn: (x: { id: string; body: any }) => api(`/lead-sources/${x.id}`, { method: 'PATCH', body: x.body }), onSuccess: done, onError: (e) => setErr(e instanceof ApiError ? e.message : String(e)) });
  return (
    <Modal open onClose={onClose} title={t('ref.sourcesTitle')} footer={<ModalCancel>{t('print.close')}</ModalCancel>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        {!q.data ? <LoadingRows rows={4} /> : (
          <ul className="divide-y divide-slate-100 rounded-field border border-slate-200">
            {q.data.map((s) => <SourceRow key={s.id} s={s} onSave={(body) => { setErr(null); patch.mutate({ id: s.id, body }); }} />)}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('ref.newSource')} className="min-w-0 flex-1">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
          <Button icon={<Plus className="h-4 w-4" />} loading={add.isPending} disabled={!name.trim()} onClick={() => { setErr(null); add.mutate(); }}>{t('ref.add')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function SourceRow({ s, onSave }: { s: LeadSource; onSave: (body: any) => void }) {
  const t = useT();
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Input aria-label={t('ref.sourceName')} className="min-w-0 flex-1 basis-40" size="sm" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== s.name) onSave({ name: name.trim() }); }} />
      {s.system_key ? <Badge tone="blue">{t('ref.systemSource')}</Badge>
        : <Checkbox checked={s.active} onChange={(e) => onSave({ active: e.target.checked })} label={t('ref.sourceActive')} />}
    </li>
  );
}
