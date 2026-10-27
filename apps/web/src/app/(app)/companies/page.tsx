'use client';
// «Kompaniyalar»: employers and insurers that pay for their people — what each owes (with ageing and the credit limit),
// the directory and their bank transfers; the reconciliation act opens as an A4 printout (docs/DISCOUNTS_COMPANIES.md).
// Manager: everything. Cashier: the directory with the receivable, and recording the transfers.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Banknote, Building2, Clock, FileText, HandCoins, Pencil, Plus, Wallet } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, formatSom } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, LinkButton, LoadingRows, Modal, ModalCancel, PageHeader, Pagination, StatCard, Table, Tabs, Td, Th, Toolbar, useToast } from '@/components/ui';
import { CsvLink, FootRow, PeriodPicker, StatRow } from '@/components/finance-extra';
import { StatMoney } from '@/components/cash-shift';
import { categoryLabel, type Company, CompanyFormModal, CompanyPaymentModal } from '@/components/discounts';

type Tab = 'receivables' | 'directory' | 'payments';

export default function CompaniesPage() { return <Suspense><Companies /></Suspense>; }

function Companies() {
  const t = useT();
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const manager = me.role === 'manager';
  const tabs: Tab[] = manager ? ['receivables', 'directory', 'payments'] : ['directory', 'payments'];
  const [tab, setTab] = useState<Tab>(tabs.includes(sp.get('tab') as Tab) ? (sp.get('tab') as Tab) : tabs[0]);
  const [from, setFrom] = useState(sp.get('from') ?? me.today.slice(0, 8) + '01');
  const [to, setTo] = useState(sp.get('to') ?? me.today);
  const [paying, setPaying] = useState<string | null>(null);
  const period = <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />;
  return (
    <>
      <PageHeader title={t('comp.title')} subtitle={t('comp.subtitle')}
        actions={<Button variant="primary" icon={<Banknote className="h-5 w-5" />} onClick={() => setPaying('')} data-testid="company-payment-open">{t('comp.recordPayment')}</Button>} />
      {tab === 'receivables' && <ReportStats from={from} to={to} branchId={branchId} />}
      <Card padded={false}>
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} label={t('comp.title')} items={tabs.map((x) => ({ value: x, label: t(`comp.tab.${x}`) }))} /></div>
        {tab === 'receivables' && <ReceivablesTab from={from} to={to} branchId={branchId} period={period} onPay={setPaying} />}
        {tab === 'directory' && <DirectoryTab onPay={setPaying} />}
        {tab === 'payments' && <PaymentsTab from={from} to={to} branchId={branchId} period={period} />}
      </Card>
      {paying !== null && <CompanyPaymentModal companyId={paying || undefined} onClose={() => setPaying(null)} />}
    </>
  );
}

const useReport = (from: string, to: string, branchId: string) =>
  useQuery({ queryKey: ['reports', 'companies', from, to, branchId], queryFn: () => api(`/reports/companies${qs({ from, to, branch_id: branchId })}`) });

function ReportStats({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const t = useT();
  const q = useReport(from, to, branchId);
  const s = q.data?.meta.totals;
  if (q.isError) return null;
  return (
    <StatRow label={t('comp.title')}>
      <StatCard icon={<HandCoins />} label={t('comp.statOutstanding')} loading={!s} tone={s?.outstanding ? 'danger' : 'default'} value={s && <StatMoney tiyin={s.outstanding} />}
        sub={s && t('comp.ageing', { a: formatSom(s.ageing['0-30'], false), b: formatSom(s.ageing['31-60'], false), c: formatSom(s.ageing['61+'], false) })} />
      <StatCard icon={<Clock />} label={t('comp.statOverdue')} loading={!s} tone={s?.overdue ? 'danger' : 'default'} value={s && <StatMoney tiyin={s.overdue} />} sub={t('comp.statOverdueSub')} />
      <StatCard icon={<FileText />} label={t('comp.statCovered')} loading={!s} value={s && <StatMoney tiyin={s.covered} />} sub={s && t('disc.nInvoices', { n: s.invoices })} />
      <StatCard icon={<Wallet />} label={t('comp.statPaid')} loading={!s} value={s && <StatMoney tiyin={s.paid} />} sub={t('comp.statPaidSub')} />
    </StatRow>
  );
}

function ReceivablesTab({ from, to, branchId, period, onPay }: { from: string; to: string; branchId: string; period: React.ReactNode; onPay: (id: string) => void }) {
  const t = useT();
  const q = useReport(from, to, branchId);
  return (<>
    <Toolbar actions={<CsvLink href={`/api/v1/reports/companies/export.csv${qs({ from, to, branch_id: branchId })}`} />}>{period}</Toolbar>
    {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('comp.noReport')} /> : (
      <Table>
        <thead><tr><Th>{t('comp.colCompany')}</Th><Th right className="hidden lg:table-cell">{t('comp.colCovered')}</Th><Th right className="hidden lg:table-cell">{t('comp.colPaid')}</Th><Th right>{t('comp.colOutstanding')}</Th><Th className="hidden xl:table-cell">{t('comp.colOverdue')}</Th><Th /></tr></thead>
        <tbody>{q.data.data.map((r: any) => (
          <tr key={r.company_id} className="group hover:bg-slate-50" data-company={r.name}>
            <Td className="min-w-[8rem] sm:min-w-[10rem]"><div className="font-semibold text-slate-900">{r.name}</div>
              <div className="text-small text-slate-600">{t(`comp.kind.${r.kind as 'employer'}`)}{r.inn ? ` · ${r.inn}` : ''}</div>
              {r.over_limit && <Badge tone="red" className="mt-1" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{t('comp.overLimit')}</Badge>}
              <div className="text-small tabular-nums text-slate-600 lg:hidden">{t('comp.colCovered')}: {formatSom(r.covered)} · {t('comp.colPaid')}: {formatSom(r.paid)}</div></Td>
            <Td right className="hidden lg:table-cell">{formatSom(r.covered)}<div className="text-small text-slate-600">{t('disc.nInvoices', { n: r.invoices })}</div></Td>
            <Td right className="hidden lg:table-cell">{formatSom(r.paid)}</Td>
            <Td right className={cx('whitespace-nowrap', r.outstanding > 0 ? 'font-semibold text-red-700' : 'text-slate-600')}>{formatSom(r.outstanding)}
              <div className="hidden whitespace-normal text-small font-normal text-slate-600 sm:block">{t('comp.ageing', { a: formatSom(r.ageing['0-30'], false), b: formatSom(r.ageing['31-60'], false), c: formatSom(r.ageing['61+'], false) })}</div></Td>
            <Td className="hidden whitespace-nowrap tabular-nums xl:table-cell">{r.overdue ? <span className="font-semibold text-red-700">{formatSom(r.overdue)}</span> : '—'}{r.credit_limit ? <div className="text-small text-slate-600">{t('comp.colLimit')}: {formatSom(r.credit_limit)}</div> : null}</Td>
            <Td right className="!pl-1">
              <div className="flex flex-nowrap items-center justify-end gap-1">
                <LinkButton size="sm" variant="ghost" href={`/print/company-act/${r.company_id}${qs({ from, to })}`} target="_blank" icon={<FileText className="h-4 w-4" />}><span className="sr-only 2xl:not-sr-only">{t('comp.openStatement')}</span></LinkButton>
                {r.outstanding > 0 && <Button size="sm" className="max-sm:!hidden" icon={<Banknote className="h-4 w-4" />} onClick={() => onPay(r.company_id)} aria-label={`${t('comp.recordPayment')}: ${r.name}`} title={t('comp.recordPayment')}><span className="sr-only 2xl:not-sr-only">{t('comp.recordPayment')}</span></Button>}
              </div>
            </Td>
          </tr>
        ))}</tbody>
        <tfoot><FootRow cells={[{ left: true, value: t('comp.nCompanies', { n: q.data.data.length }) }, { className: 'hidden lg:table-cell', value: formatSom(q.data.meta.totals.covered) },
          { className: 'hidden lg:table-cell', value: formatSom(q.data.meta.totals.paid) }, { className: 'text-red-700', value: formatSom(q.data.meta.totals.outstanding) },
          { className: 'hidden xl:table-cell text-left', value: q.data.meta.totals.overdue ? formatSom(q.data.meta.totals.overdue) : '—' }, {}]} /></tfoot>
      </Table>
    )}
  </>);
}

function DirectoryTab({ onPay }: { onPay: (id: string) => void }) {
  const t = useT();
  const { me } = useSession();
  const manager = me.role === 'manager';
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const q = useQuery({ queryKey: ['companies', 'directory', page], queryFn: () => api(`/companies${qs({ all: manager ? 1 : '', page, page_size: 20 })}`), placeholderData: (p) => p });
  return (<>
    {manager && <Toolbar actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('comp.add')}</Button>} />}
    {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('comp.noCompanies')} /> : <>
      <Table>
        <thead><tr><Th>{t('comp.colCompany')}</Th><Th className="hidden md:table-cell">{t('comp.coverageCategories')}</Th><Th right className="hidden sm:table-cell">{t('comp.terms')}</Th><Th right>{t('comp.colOutstanding')}</Th><Th /></tr></thead>
        <tbody>{q.data.data.map((c: Company) => (
          <tr key={c.id} className={cx('group hover:bg-slate-50', c.active === false && 'text-slate-600')}>
            <Td className="min-w-[8rem] sm:min-w-[10rem]"><div className="font-semibold text-slate-900">{c.name}</div>
              <div className="text-small text-slate-600">{t(`comp.kind.${c.kind}`)}{c.inn ? ` · ${c.inn}` : ''}{c.contract_number ? ` · ${c.contract_number}` : ''}</div>
              {c.active === false && <Badge className="mt-1">{t('comp.inactive')}</Badge>}
              <div className="text-small text-slate-600 md:hidden">{Number(c.coverage_percent)}% · {c.coverage_categories?.length ? c.coverage_categories.map((x) => categoryLabel(t, x)).join(', ') : t('comp.allServices')}</div></Td>
            <Td className="hidden md:table-cell"><span className="font-medium tabular-nums">{Number(c.coverage_percent)}%</span> · {c.coverage_categories?.length ? c.coverage_categories.map((x) => categoryLabel(t, x)).join(', ') : t('comp.allServices')}</Td>
            <Td right className="hidden tabular-nums sm:table-cell">{c.payment_terms_days}{c.credit_limit ? <div className="whitespace-nowrap text-small text-slate-600">{t('comp.colLimit')}: {formatSom(c.credit_limit)}</div> : null}</Td>
            <Td right className={cx('whitespace-nowrap', Number(c.outstanding) > 0 ? 'font-semibold text-red-700' : 'text-slate-600')}>{formatSom(Number(c.outstanding ?? 0))}</Td>
            <Td right className="!pl-1">
              <div className="flex flex-nowrap items-center justify-end gap-1">
                {Number(c.outstanding) > 0 && <Button size="sm" variant="ghost" className="max-sm:!hidden" icon={<Banknote className="h-4 w-4" />} onClick={() => onPay(c.id)} aria-label={`${t('comp.recordPayment')}: ${c.name}`}><span className="sr-only xl:not-sr-only">{t('comp.recordPayment')}</span></Button>}
                {manager && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(c)} aria-label={`${t('registrar.edit')}: ${c.name}`}><span className="sr-only xl:not-sr-only">{t('registrar.edit')}</span></Button>}
              </div>
            </Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
    </>}
    {editing && <CompanyFormModal company={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </>);
}

function PaymentsTab({ from, to, branchId, period }: { from: string; to: string; branchId: string; period: React.ReactNode }) {
  const t = useT();
  const { me } = useSession();
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<any>(null);
  useEffect(() => setPage(1), [from, to, branchId]);
  const q = useQuery({ queryKey: ['company-payments', from, to, branchId, page], queryFn: () => api(`/company-payments${qs({ from, to, branch_id: branchId, page, page_size: 20 })}`), placeholderData: (p) => p });
  return (<>
    <Toolbar>{period}</Toolbar>
    {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('comp.noPayments')} /> : <>
      <Table>
        <thead><tr><Th className="hidden sm:table-cell">{t('cash.colTime')}</Th><Th>{t('comp.colCompany')}</Th><Th className="hidden md:table-cell">{t('comp.allocations')}</Th><Th right>{t('cash.colSum')}</Th><Th /></tr></thead>
        <tbody>{q.data.data.map((p: any) => (
          <tr key={p.id} className={cx('group hover:bg-slate-50', p.status === 'void' && 'text-slate-600')}>
            <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{fmtDateTime(p.received_at)}<div className="text-small text-slate-600">№{p.number} · {p.created_by_name}</div></Td>
            <Td className="min-w-[10rem]"><div className="font-medium text-slate-900">{p.company_name}</div>
              <div className="text-small text-slate-600">{p.document_number ? `${t('comp.document')} ${p.document_number}` : ''}{p.document_date ? ` · ${fmtDate(p.document_date)}` : ''}</div>
              <div className="text-small tabular-nums text-slate-600 sm:hidden">№{p.number} · {fmtDateTime(p.received_at)}</div>
              {p.status === 'void' && <div className="mt-1"><Badge icon={<Ban className="h-3.5 w-3.5" />}>{t('comp.voidedBadge')}</Badge><span className="ml-2 text-small">{p.void_reason}</span></div>}</Td>
            <Td className="hidden md:table-cell"><span className="text-small">{t('comp.invoicesShort', { list: (p.allocations ?? []).map((a: any) => `№${a.invoice_number}`).join(', ') })}</span></Td>
            <Td right className={p.status === 'void' ? 'line-through' : 'font-medium'}>{formatSom(p.amount)}</Td>
            <Td right className="!pl-1">{me.role === 'manager' && p.status === 'active' && <Button size="sm" variant="ghost" className="!text-slate-700 hover:!bg-red-50 hover:!text-red-700" icon={<Ban className="h-4 w-4" />} onClick={() => setVoiding(p)} aria-label={`${t('comp.void')}: №${p.number}`}><span className="sr-only xl:not-sr-only">{t('comp.void')}</span></Button>}</Td>
          </tr>
        ))}</tbody>
        <tfoot><FootRow cells={[{ className: 'hidden sm:table-cell' }, { left: true, value: t('comp.nPayments', { n: q.data.meta.total }) }, { className: 'hidden md:table-cell' }, { value: formatSom(q.data.meta.sum) }, {}]} /></tfoot>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
    </>}
    {voiding && <VoidModal payment={voiding} onClose={() => setVoiding(null)} />}
  </>);
}

function VoidModal({ payment, onClose }: { payment: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/company-payments/${payment.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { ['company-payments', 'companies', 'reports', 'invoices', 'finance-summary', 'dashboard', 'payments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('comp.voided')); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open onClose={onClose} dirty={!!reason.trim()} title={t('comp.voidTitle', { n: payment.number })}
      footer={<><ModalCancel>{t('common.back')}</ModalCancel><Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>{t('comp.void')}</Button></>}>
      <div className="space-y-3">
        <p className="text-body"><Building2 className="mr-1 inline h-4 w-4" />{payment.company_name} — <b className="tabular-nums">{formatSom(payment.amount)}</b></p>
        <Field label={t('cash.colReason')} required>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />}</Field>
        <p className="text-small text-slate-600">{t('comp.voidHint')}</p>
      </div>
    </Modal>
  );
}
