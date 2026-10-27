'use client';
// «Chegirmalar»: the discounts given in a period (by rule, benefit category, who granted it or service), the discount
// rules and the benefit categories (docs/DISCOUNTS_COMPANIES.md). Manager only.
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BadgePercent, Banknote, Pencil, Plus, ReceiptText } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, formatSom } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, cx, EmptyState, ErrorState, LoadingRows, PageHeader, Segmented, StatCard, Table, Tabs, Td, Th, Toolbar } from '@/components/ui';
import { CsvLink, FootRow, PeriodPicker, StatRow } from '@/components/finance-extra';
import { StatMoney } from '@/components/cash-shift';
import { type Category, CategoryFormModal, type Rule, RuleFormModal, ruleStaffMax, ruleValue, scopeText, useCategories, useRules } from '@/components/discounts';

type Tab = 'report' | 'rules' | 'categories';
const TABS: Tab[] = ['report', 'rules', 'categories'];
type Group = 'rule' | 'category' | 'staff' | 'service';

export default function DiscountsPage() { return <Suspense><Discounts /></Suspense>; }

function Discounts() {
  const t = useT();
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(TABS.includes(sp.get('tab') as Tab) ? (sp.get('tab') as Tab) : 'report');
  const [from, setFrom] = useState(sp.get('from') ?? me.today.slice(0, 8) + '01');
  const [to, setTo] = useState(sp.get('to') ?? me.today);
  const [group, setGroup] = useState<Group>('rule');
  const [adding, setAdding] = useState<'rule' | 'category' | null>(null);
  const report = useQuery({ queryKey: ['reports', 'discounts', from, to, branchId, group], queryFn: () => api(`/reports/discounts${qs({ from, to, branch_id: branchId, group })}`), enabled: tab === 'report' });
  const tot = report.data?.meta.totals;
  return (
    <>
      <PageHeader title={t('disc.title')} subtitle={t('disc.subtitle')}
        actions={tab !== 'report' && <Button variant="primary" icon={<Plus className="h-5 w-5" />} onClick={() => setAdding(tab === 'rules' ? 'rule' : 'category')}>{tab === 'rules' ? t('disc.addRule') : t('disc.addCategory')}</Button>} />
      {tab === 'report' && !report.isError && (
        <StatRow label={t('disc.title')} cols={4}>
          <StatCard icon={<BadgePercent />} label={t('disc.statDiscount')} loading={!tot} value={tot && <StatMoney tiyin={tot.discount} />} sub={t('disc.statSub')} />
          <StatCard icon={<ReceiptText />} label={t('disc.colInvoices')} loading={!tot} value={tot && <span className="tabular-nums">{tot.invoices}</span>} sub={tot && t('disc.nServices', { n: tot.services })} />
          <StatCard icon={<Banknote />} label={t('disc.statGross')} loading={!tot} value={tot && <StatMoney tiyin={tot.gross} />} />
          <StatCard icon={<Banknote />} label={t('disc.statNet')} loading={!tot} value={tot && <StatMoney tiyin={tot.net} />} />
        </StatRow>
      )}
      <Card padded={false}>
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} label={t('disc.title')} items={[
          { value: 'report', label: t('disc.tab.report') }, { value: 'rules', label: t('disc.tab.rules') }, { value: 'categories', label: t('disc.tab.categories') },
        ]} /></div>
        {tab === 'report' && <>
          <Toolbar actions={<CsvLink href={`/api/v1/reports/discounts/export.csv${qs({ from, to, branch_id: branchId, group })}`} />}>
            <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
            <Segmented label={t('disc.group')} value={group} onChange={setGroup} className="w-full sm:w-auto" stretch
              options={(['rule', 'category', 'staff', 'service'] as const).map((g) => ({ value: g, label: t(`disc.group.${g}`) }))} />
          </Toolbar>
          {report.isLoading ? <LoadingRows /> : report.isError ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : !report.data.data.length ? <EmptyState compact title={t('disc.noReport')} /> : (
            <Table>
              <thead><tr><Th>{t(`disc.group.${group}`)}</Th><Th right className="hidden sm:table-cell">{t('disc.colInvoices')}</Th><Th right className="hidden md:table-cell">{t('disc.colGross')}</Th><Th right>{t('disc.colDiscount')}</Th><Th right className="hidden sm:table-cell">{t('disc.colNet')}</Th></tr></thead>
              <tbody>{report.data.data.map((r: any) => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <Td className="min-w-[9rem]"><div className="font-medium text-slate-900">{r.label || (group === 'rule' ? t('disc.manual') : group === 'category' ? t('disc.noCategory') : '—')}</div>
                    <div className="text-small tabular-nums text-slate-600 sm:hidden">{t('disc.nInvoices', { n: r.invoices })} · {formatSom(r.net)}</div></Td>
                  <Td right className="hidden tabular-nums sm:table-cell">{r.invoices}<div className="text-small text-slate-600">{t('disc.nServices', { n: r.services })}</div></Td>
                  <Td right className="hidden md:table-cell">{formatSom(r.gross)}</Td>
                  <Td right className="font-semibold text-emerald-800">−{formatSom(r.discount)}</Td>
                  <Td right className="hidden sm:table-cell">{formatSom(r.net)}</Td>
                </tr>
              ))}</tbody>
              <tfoot><FootRow cells={[{ left: true, value: t('clinical.rep.total') }, { className: 'hidden sm:table-cell', value: tot.invoices }, { className: 'hidden md:table-cell', value: formatSom(tot.gross) },
                { className: 'text-emerald-800', value: `−${formatSom(tot.discount)}` }, { className: 'hidden sm:table-cell', value: formatSom(tot.net) }]} /></tfoot>
            </Table>
          )}
        </>}
        {tab === 'rules' && <RulesTab />}
        {tab === 'categories' && <CategoriesTab />}
      </Card>
      {adding === 'rule' && <RuleFormModal onClose={() => setAdding(null)} />}
      {adding === 'category' && <CategoryFormModal onClose={() => setAdding(null)} />}
    </>
  );
}

function RulesTab() {
  const t = useT();
  const q = useRules(true);
  const [editing, setEditing] = useState<Rule | null>(null);
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState compact title={t('disc.noRules')} />;
  return (<>
    <Table>
      <thead><tr><Th>{t('disc.rule')}</Th><Th right>{t('disc.value')}</Th><Th className="hidden md:table-cell">{t('disc.scope')}</Th><Th className="hidden lg:table-cell">{t('disc.validFrom')}</Th><Th /></tr></thead>
      <tbody>{q.data.map((r) => (
        <tr key={r.id} className={cx('group hover:bg-slate-50', !r.active && 'text-slate-600')}>
          <Td className="min-w-[10rem]"><div className="font-semibold text-slate-900">{r.name}</div>
            <div className="text-small text-slate-600">{t('disc.staffUpTo', { max: ruleStaffMax(r) })}</div>
            <div className="text-small text-slate-600 md:hidden">{scopeText(t, r.scope, r.categories, r.service_ids.length)}</div>
            {!r.active && <Badge className="mt-1">{t('disc.inactive')}</Badge>}</Td>
          <Td right className="whitespace-nowrap font-semibold tabular-nums">{ruleValue(r)}</Td>
          <Td className="hidden md:table-cell">{scopeText(t, r.scope, r.categories, r.service_ids.length)}</Td>
          <Td className="hidden whitespace-nowrap tabular-nums lg:table-cell">{r.valid_from || r.valid_to ? t('disc.validRange', { from: r.valid_from ? fmtDate(r.valid_from) : '…', to: r.valid_to ? fmtDate(r.valid_to) : '…' }) : t('disc.validAlways')}</Td>
          <Td right className="!pl-1"><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(r)} aria-label={`${t('registrar.edit')}: ${r.name}`}><span className="sr-only lg:not-sr-only">{t('registrar.edit')}</span></Button></Td>
        </tr>
      ))}</tbody>
    </Table>
    {editing && <RuleFormModal rule={editing} onClose={() => setEditing(null)} />}
  </>);
}

function CategoriesTab() {
  const t = useT();
  const q = useCategories(true);
  const [editing, setEditing] = useState<Category | null>(null);
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState compact title={t('disc.noCategories')} />;
  return (<>
    <Table>
      <thead><tr><Th>{t('disc.category')}</Th><Th className="hidden sm:table-cell">{t('disc.defaultRule')}</Th><Th className="hidden md:table-cell">{t('disc.docLabel')}</Th><Th /></tr></thead>
      <tbody>{q.data.map((c) => (
        <tr key={c.id} className={cx('group hover:bg-slate-50', !c.active && 'text-slate-600')}>
          <Td className="min-w-[9rem]"><div className="font-semibold text-slate-900">{c.name}</div>{!c.active && <Badge className="mt-1">{t('disc.inactive')}</Badge>}
            {c.requires_document && <div className="text-small text-slate-600 md:hidden">{c.document_label}</div>}
            <div className="text-small font-medium text-slate-700 sm:hidden">{c.discount_rule_name ?? t('disc.noRule')}</div></Td>
          <Td className="hidden sm:table-cell">{c.discount_rule_name ?? <span className="text-slate-600">{t('disc.noRule')}</span>}</Td>
          <Td className="hidden md:table-cell">{c.requires_document ? c.document_label : '—'}</Td>
          <Td right className="!pl-1"><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(c)} aria-label={`${t('registrar.edit')}: ${c.name}`}><span className="sr-only lg:not-sr-only">{t('registrar.edit')}</span></Button></Td>
        </tr>
      ))}</tbody>
    </Table>
    {editing && <CategoryFormModal category={editing} onClose={() => setEditing(null)} />}
  </>);
}
