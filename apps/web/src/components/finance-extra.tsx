'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus, Printer } from 'lucide-react';
import { EXPENSE_CATEGORIES, EXPENSE_PAID_FROM_LABEL, PAYMENT_METHOD_LABEL, REFUND_REASON_LABEL } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime, formatSom, fullName, parseSomToTiyin, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Select, Table, Td, Th, useToast } from '@/components/ui';
import { CloseShiftModal, type Shift } from '@/components/cash-shift';

type Summary = { payments: { total: number; count: number }; refunds: { total: number; count: number }; net_revenue: number; expenses: { total: number }; net_result: number };

/** Cash-basis result for the period: payments − refunds = net revenue; − expenses = net result. */
export function FinanceSummary({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const q = useQuery({ queryKey: ['finance-summary', from, to, branchId], queryFn: () => api<{ data: Summary }>(`/finance/summary${qs({ from, to, branch_id: branchId })}`).then((r) => r.data) });
  if (!q.data) return null;
  const s = q.data;
  const cell = (label: string, value: number, tone?: string, sign = '') => (
    <div className="min-w-[140px]"><div className="text-2xs uppercase tracking-wide text-slate-500">{label}</div><div className={cx('text-lg font-semibold tabular-nums', tone)}>{sign}{formatSom(value)}</div></div>
  );
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-slate-100 px-4 py-3" aria-label="Moliyaviy natija">
      {cell(`Tushum (${s.payments.count} to‘lov)`, s.payments.total)}
      {cell(`Qaytarishlar (${s.refunds.count})`, s.refunds.total, s.refunds.total ? 'text-red-700' : 'text-slate-400', s.refunds.total ? '−' : '')}
      {cell('Sof tushum', s.net_revenue)}
      {cell('Xarajatlar', s.expenses.total, s.expenses.total ? 'text-red-700' : 'text-slate-400', s.expenses.total ? '−' : '')}
      {cell('Sof natija', s.net_result, s.net_result >= 0 ? 'text-emerald-700' : 'text-red-700')}
    </div>
  );
}

export function RefundsTab({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const q = useQuery({ queryKey: ['refunds', from, to, branchId], queryFn: () => api(`/refunds${qs({ from, to, branch_id: branchId })}`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return !q.data.data.length ? <EmptyState title="Bu davrda qaytarish yo‘q" /> : (
    <>
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">Jami qaytarilgan: <b className="tabular-nums text-red-700">{formatSom(q.data.meta.total)}</b> ({q.data.data.length} ta)</div>
      <Table>
        <thead><tr><Th>№</Th><Th>Vaqt</Th><Th>Bemor</Th><Th>Hisob</Th><Th>Usul / kassa</Th><Th>Sabab</Th><Th>Tasdiqladi</Th><Th right>Summa</Th></tr></thead>
        <tbody>{q.data.data.map((r: any) => (
          <tr key={r.id}>
            <Td className="tabular-nums">{r.refund_number}</Td><Td className="whitespace-nowrap">{fmtDateTime(r.refunded_at)}</Td>
            <Td>{fullName(r)} <span className="text-slate-500">{pid(r.patient_number)}</span></Td>
            <Td><Link href={`/cashier/${r.invoice_id}`} className="text-brand-700 hover:underline">№{r.invoice_number}</Link></Td>
            <Td>{PAYMENT_METHOD_LABEL[r.method]}{r.shift_number ? <span className="block text-xs text-slate-500">smena №{r.shift_number} · {r.shift_cashier}</span> : null}</Td>
            <Td>{REFUND_REASON_LABEL[r.reason_code]}<span className="block text-xs text-slate-500">{r.reason}</span></Td><Td>{r.approved_by_name}</Td>
            <Td right className="font-medium text-red-700">−{formatSom(r.amount)}</Td>
          </tr>
        ))}</tbody>
      </Table>
    </>
  );
}

export function ShiftsTab({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const { me } = useSession();
  const [closing, setClosing] = useState<Shift | null>(null);
  const q = useQuery({ queryKey: ['cash-shifts', 'list', from, to, branchId], queryFn: () => api<{ data: Shift[] }>(`/cash-shifts${qs({ from, to, branch_id: branchId })}`).then((r) => r.data) });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return !q.data!.length ? <EmptyState title="Bu davrda smena yo‘q" /> : (
    <>
      <Table>
        <thead><tr><Th>№</Th><Th>Kassir</Th><Th>Filial</Th><Th>Ochilgan</Th><Th>Yopilgan</Th><Th right>Naqd tushum</Th><Th right>Kassada bo‘lishi kerak</Th><Th right>Sanalgan</Th><Th right>Farq</Th><Th /></tr></thead>
        <tbody>{q.data!.map((s) => (
          <tr key={s.id}>
            <Td className="tabular-nums">{s.number}</Td><Td>{s.cashier_name}</Td><Td>{s.branch_name}</Td>
            <Td className="whitespace-nowrap">{fmtDateTime(s.opened_at)}</Td>
            <Td className="whitespace-nowrap">{s.status === 'open' ? <Badge tone="green">Ochiq</Badge> : fmtDateTime((s as any).closed_at)}</Td>
            <Td right>{formatSom(s.totals.payments.cash.sum)}</Td><Td right>{formatSom(s.expected_cash)}</Td>
            <Td right>{s.counted_cash == null ? '—' : formatSom(s.counted_cash)}</Td>
            <Td right className={cx('font-medium', s.difference ? (s.difference > 0 ? 'text-amber-700' : 'text-red-700') : 'text-slate-500')}>{s.difference == null ? '—' : s.difference === 0 ? '0' : `${s.difference > 0 ? '+' : ''}${formatSom(s.difference)}`}</Td>
            <Td right className="whitespace-nowrap">
              <Link href={`/print/shift/${s.id}`} target="_blank" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline"><Printer className="h-3.5 w-3.5" />Hisobot</Link>
              {me.role === 'manager' && s.status === 'open' && <Button size="sm" variant="ghost" className="ml-2" onClick={() => setClosing(s)}>Yopish</Button>}
            </Td>
          </tr>
        ))}</tbody>
      </Table>
      <p className="px-4 py-2 text-xs text-slate-500">Kassada bo‘lishi kerak = boshlang‘ich naqd + naqd to‘lovlar − naqd qaytarishlar − kassadan xarajatlar. Yopilgan smena o‘zgartirilmaydi.</p>
      {closing && <CloseShiftModal shift={closing} onClose={() => setClosing(null)} />}
    </>
  );
}

export function ExpenseActions({ onAdd }: { onAdd: () => void }) {
  return <Button size="sm" variant="primary" className="ml-auto" icon={<Plus className="h-3.5 w-3.5" />} onClick={onAdd}>Xarajat qo‘shish</Button>;
}

export function ExpenseRowActions({ e }: { e: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/expenses/${e.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { ['expenses', 'finance-summary', 'cash-shifts', 'cash-shift'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success('Xarajat bekor qilindi'); setOpen(false); },
    onError: (err) => toast.error(err),
  });
  if (e.status !== 'active') return null;
  const locked = e.shift_status === 'closed';
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5" />} disabled={locked} title={locked ? 'Yopilgan smenadagi xarajat o‘zgarmaydi' : undefined} onClick={() => setOpen(true)}>Bekor qilish</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Xarajatni bekor qilish: ${e.category}, ${formatSom(e.amount)}`}
        footer={<><Button onClick={() => setOpen(false)}>Ortga</Button><Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>Bekor qilish</Button></>}>
        <Field label="Sabab" required>{(id) => <Input id={id} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Masalan: ikki marta kiritilgan" />}</Field>
      </Modal>
    </>
  );
}

/** Manager: any expense (bank, card, other) or cash taken from an open drawer. */
export function ExpenseModal({ onClose }: { onClose: () => void }) {
  const { me, branchId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState(branchId || me.branches[0]?.id || '');
  const [category, setCategory] = useState<string>('Ijara');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(me.today);
  const [paidFrom, setPaidFrom] = useState('bank');
  const [shiftId, setShiftId] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const shifts = useQuery({ queryKey: ['cash-shifts', 'open', branch], queryFn: () => api<{ data: Shift[] }>(`/cash-shifts?status=open&branch_id=${branch}`).then((r) => r.data), enabled: paidFrom === 'cash_drawer' && !!branch });
  const chosenShift = shiftId || (shifts.data?.length === 1 ? shifts.data[0].id : '');
  const tiyin = amount.trim() ? parseSomToTiyin(amount) : null;
  const m = useMutation({
    mutationFn: () => api('/expenses', { method: 'POST', body: { branch_id: branch, category, amount: tiyin, occurred_on: paidFrom === 'cash_drawer' ? undefined : date, paid_from: paidFrom, shift_id: paidFrom === 'cash_drawer' ? chosenShift || undefined : undefined, note: note.trim() || null } }),
    onSuccess: () => { ['expenses', 'finance-summary', 'cash-shifts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success('Xarajat qo‘shildi'); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); else setErr((e as Error).message); },
  });
  const ready = !!branch && !!tiyin && (paidFrom !== 'cash_drawer' || !!chosenShift);
  return (
    <Modal open onClose={onClose} dirty={!!amount} title="Xarajat qo‘shish" footer={<><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" loading={m.isPending} disabled={!ready} onClick={() => { setErr(null); setErrors({}); m.mutate(); }}>Qo‘shish</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {me.branches.length > 1 && <Field label="Filial" required error={errors.branch_id}>{(id) => <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value)}>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>}
          <Field label="Kategoriya" required>{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
          <Field label="Summa, so‘m" required error={errors.amount ?? (amount && tiyin == null ? 'Raqam kiriting' : undefined)}>{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Qayerdan to‘landi" required>{(id) => <Select id={id} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>{Object.entries(EXPENSE_PAID_FROM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          {paidFrom === 'cash_drawer'
            ? <Field label="Qaysi kassadan" required error={errors.shift_id}>{(id) => shifts.data?.length === 0
                ? <p id={id} className="text-sm text-amber-700">Bu filialda ochiq kassa yo‘q.</p>
                : <Select id={id} value={chosenShift} onChange={(e) => setShiftId(e.target.value)}>{(shifts.data?.length ?? 0) > 1 && <option value="">— tanlang —</option>}{(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>Smena №{s.number} · {s.cashier_name}</option>)}</Select>}</Field>
            : <Field label="Sana" required error={errors.occurred_on}>{(id) => <Input id={id} type="date" max={me.today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>}
        </div>
        <Field label="Izoh">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: noyabr oyi ijarasi" />}</Field>
      </div>
    </Modal>
  );
}

export const expenseStatusCell = (e: any) => e.status === 'void'
  ? <Badge>Bekor qilingan{e.void_reason ? `: ${e.void_reason}` : ''}</Badge>
  : <span className="text-xs text-slate-500">{EXPENSE_PAID_FROM_LABEL[e.paid_from] ?? ''}{e.shift_number ? ` · smena №${e.shift_number}` : ''}{e.created_by_name ? ` · ${e.created_by_name}` : ''}</span>;
