'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorClosed, DoorOpen, Printer, ReceiptText } from 'lucide-react';
import { EXPENSE_CATEGORIES } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtTime, formatSom, parseSomToTiyin } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, Card, cx, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';

export type Shift = {
  id: string; number: number; status: 'open' | 'closed'; branch_id: string; branch_name: string; cashier_name: string; opened_at: string; opening_cash: number;
  expected_cash: number; counted_cash: number | null; difference: number | null;
  totals: { payments: Record<'cash' | 'card' | 'transfer', { n: number; sum: number }>; refunds: Record<'cash' | 'card' | 'transfer', { n: number; sum: number }>; cash_expenses: { n: number; sum: number }; cash_in: number; cash_out: number };
};

/** The signed-in cashier's open shift (null when the drawer is closed). */
export function useCurrentShift(enabled = true) {
  return useQuery({ queryKey: ['cash-shift', 'current'], queryFn: () => api<{ data: Shift | null }>('/cash-shifts/current').then((r) => r.data), enabled, refetchInterval: 30_000 });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => ['cash-shift', 'cash-shifts', 'invoices', 'payments', 'expenses', 'dashboard', 'finance-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

/** Cashier: drawer state, open / close shift, cash expense. */
export function ShiftPanel() {
  const shift = useCurrentShift();
  const [modal, setModal] = useState<'open' | 'close' | 'expense' | null>(null);
  if (shift.isLoading) return null;
  const s = shift.data;
  return (
    <Card padded={false} className={cx('mb-4', s ? 'border-emerald-200' : 'border-amber-300')}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        {s ? <>
          <div className="flex items-center gap-2"><DoorOpen className="h-5 w-5 text-emerald-600" /><div className="leading-tight"><div className="font-semibold">Smena №{s.number} ochiq · {s.branch_name}</div><div className="text-xs text-slate-500">{fmtTime(s.opened_at)} dan beri · boshlang‘ich naqd {formatSom(s.opening_cash)}</div></div></div>
          <div className="text-sm"><span className="text-slate-500">Naqd tushum:</span> <b className="tabular-nums">{formatSom(s.totals.payments.cash.sum)}</b></div>
          <div className="text-sm"><span className="text-slate-500">Karta/o‘tkazma:</span> <b className="tabular-nums">{formatSom(s.totals.payments.card.sum + s.totals.payments.transfer.sum)}</b></div>
          {s.totals.cash_out > 0 && <div className="text-sm"><span className="text-slate-500">Kassadan chiqim:</span> <b className="tabular-nums">−{formatSom(s.totals.cash_out)}</b></div>}
          <div className="text-sm"><span className="text-slate-500">Kassada bo‘lishi kerak:</span> <b className="tabular-nums text-emerald-800">{formatSom(s.expected_cash)}</b></div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" icon={<ReceiptText className="h-4 w-4" />} onClick={() => setModal('expense')}>Kassadan xarajat</Button>
            <Link href={`/print/shift/${s.id}`} target="_blank" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[0.8125rem] font-medium text-slate-700 hover:bg-slate-50"><Printer className="h-3.5 w-3.5" />Hisobot</Link>
            <Button size="sm" variant="primary" icon={<DoorClosed className="h-4 w-4" />} onClick={() => setModal('close')}>Smenani yopish</Button>
          </div>
        </> : <>
          <div className="flex items-center gap-2"><DoorClosed className="h-5 w-5 text-amber-600" /><div className="leading-tight"><div className="font-semibold">Smena yopiq</div><div className="text-xs text-slate-500">To‘lov qabul qilish uchun smenani kassadagi boshlang‘ich naqd pul bilan oching.</div></div></div>
          <Button className="ml-auto" variant="primary" icon={<DoorOpen className="h-4 w-4" />} onClick={() => setModal('open')}>Smenani ochish</Button>
        </>}
      </div>
      {modal === 'open' && <OpenShiftModal onClose={() => setModal(null)} />}
      {modal === 'close' && s && <CloseShiftModal shift={s} onClose={() => setModal(null)} />}
      {modal === 'expense' && s && <CashExpenseModal shift={s} onClose={() => setModal(null)} />}
    </Card>
  );
}

function OpenShiftModal({ onClose }: { onClose: () => void }) {
  const { me, branchId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState(branchId || me.branches[0]?.id || '');
  const [cash, setCash] = useState('0');
  const [err, setErr] = useState<string | null>(null);
  const tiyin = parseSomToTiyin(cash);
  const m = useMutation({
    mutationFn: () => api<{ data: { number: number } }>('/cash-shifts', { method: 'POST', body: { branch_id: branch, opening_cash: tiyin } }),
    onSuccess: (r) => { invalidate(qc); toast.success(`Smena №${r.data.number} ochildi`); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Modal open onClose={onClose} title="Smenani ochish" footer={<><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" loading={m.isPending} disabled={tiyin == null || !branch} onClick={() => m.mutate()}>Ochish</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        {me.branches.length > 1 && <Field label="Filial" required>{(id) => <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value)}>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>}
        <Field label="Kassadagi boshlang‘ich naqd pul, so‘m" required error={tiyin == null ? 'Summani raqam bilan kiriting' : undefined} hint="Qaytim uchun qoldirilgan pulni sanab yozing">
          {(id) => <Input id={id} inputMode="decimal" className="w-48" value={cash} onChange={(e) => { setCash(e.target.value); setErr(null); }} invalid={tiyin == null} />}
        </Field>
      </div>
    </Modal>
  );
}

export function CloseShiftModal({ shift: initial, onClose }: { shift: Shift; onClose: () => void }) {
  const qc = useQueryClient();
  // live numbers: a payment may arrive while the modal is open (the server recomputes on close anyway)
  const live = useQuery({ queryKey: ['cash-shift', initial.id], queryFn: () => api<{ data: Shift }>(`/cash-shifts/${initial.id}`).then((r) => r.data), refetchInterval: 10_000 });
  const shift = live.data ?? initial;
  const toast = useToast();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const tiyin = counted.trim() ? parseSomToTiyin(counted) : null;
  const diff = tiyin == null ? null : tiyin - shift.expected_cash;
  const m = useMutation({
    mutationFn: () => api<{ data: { difference: number } }>(`/cash-shifts/${shift.id}/close`, { method: 'POST', body: { counted_cash: tiyin, note: note.trim() || null } }),
    onSuccess: (r) => { invalidate(qc); toast.success(r.data.difference ? `Smena yopildi, farq ${formatSom(r.data.difference)}` : 'Smena yopildi, kassa mos'); onClose(); window.open(`/print/shift/${shift.id}`, '_blank', 'noopener'); },
    onError: (e) => {
      // a field error the form does not show (e.g. the expected cash changed meanwhile) must still be visible
      if (e instanceof ApiError && e.fields) { setErrors(e.fields); setErr(e.fields.counted_cash || e.fields.note ? null : e.message); live.refetch(); }
      else setErr((e as Error).message);
    },
  });
  const t = shift.totals;
  return (
    <Modal open onClose={onClose} dirty={!!counted} title={`Smena №${shift.number} ni yopish`} footer={<><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" loading={m.isPending} disabled={tiyin == null || (diff !== 0 && !note.trim())} onClick={() => m.mutate()}>Yopish</Button></>}>
      <div className="space-y-3 text-sm">
        {err && <Alert tone="red">{err}</Alert>}
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-md border border-slate-200 p-3">
          <dt className="text-slate-600">Boshlang‘ich naqd</dt><dd className="text-right tabular-nums">{formatSom(shift.opening_cash)}</dd>
          <dt className="text-slate-600">+ Naqd to‘lovlar ({t.payments.cash.n})</dt><dd className="text-right tabular-nums">{formatSom(t.payments.cash.sum)}</dd>
          {t.refunds.cash.sum > 0 && <><dt className="text-slate-600">− Naqd qaytarishlar ({t.refunds.cash.n})</dt><dd className="text-right tabular-nums">{formatSom(t.refunds.cash.sum)}</dd></>}
          {t.cash_expenses.sum > 0 && <><dt className="text-slate-600">− Kassadan xarajatlar ({t.cash_expenses.n})</dt><dd className="text-right tabular-nums">{formatSom(t.cash_expenses.sum)}</dd></>}
          <dt className="border-t border-slate-100 pt-1 font-semibold">Kassada bo‘lishi kerak</dt><dd className="border-t border-slate-100 pt-1 text-right font-semibold tabular-nums">{formatSom(shift.expected_cash)}</dd>
        </dl>
        <p className="text-xs text-slate-500">Karta: {formatSom(t.payments.card.sum)} · O‘tkazma: {formatSom(t.payments.transfer.sum)} — kassaga kirmaydi, hisobotda alohida.</p>
        <Field label="Kassada sanalgan naqd pul, so‘m" required error={errors.counted_cash ?? (counted && tiyin == null ? 'Summani raqam bilan kiriting' : undefined)}>
          {(id) => <Input id={id} inputMode="decimal" className="w-48" value={counted} onChange={(e) => { setCounted(e.target.value); setErrors({}); }} autoFocus />}
        </Field>
        {diff != null && <Alert tone={diff === 0 ? 'green' : 'yellow'} title={diff === 0 ? 'Kassa mos' : `Farq: ${diff > 0 ? '+' : ''}${formatSom(diff)}`}>{diff === 0 ? 'Sanalgan pul kutilgan summaga teng.' : diff > 0 ? 'Kassada ortiqcha pul bor.' : 'Kassada pul yetmayapti.'}</Alert>}
        {diff != null && (diff !== 0 || errors.note) && (
          <Field label="Farq sababi" required error={errors.note}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: qaytim xatosi" />}</Field>
        )}
        <p className="text-xs text-slate-500">Yopilgan smena o‘zgartirilmaydi. Hisobot yangi oynada ochiladi.</p>
      </div>
    </Modal>
  );
}

function CashExpenseModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [category, setCategory] = useState<string>('Xo‘jalik');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const tiyin = amount.trim() ? parseSomToTiyin(amount) : null;
  const m = useMutation({
    mutationFn: () => api('/expenses', { method: 'POST', body: { category, amount: tiyin, note: note.trim() || null, paid_from: 'cash_drawer' } }),
    onSuccess: () => { invalidate(qc); toast.success('Xarajat yozildi'); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Modal open onClose={onClose} dirty={!!amount} title="Kassadan xarajat" footer={<><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" loading={m.isPending} disabled={!tiyin || !note.trim()} onClick={() => m.mutate()}>Yozish</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <p className="text-sm text-slate-600">Naqd pul smena №{shift.number} kassasidan chiqadi va smena hisobotida ko‘rinadi. Kassada hozir: <b>{formatSom(shift.expected_cash)}</b>.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kategoriya" required>{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
          <Field label="Summa, so‘m" required error={amount && tiyin == null ? 'Raqam kiriting' : undefined}>{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        </div>
        <Field label="Nima uchun" required>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: ichimlik suvi" />}</Field>
      </div>
    </Modal>
  );
}
