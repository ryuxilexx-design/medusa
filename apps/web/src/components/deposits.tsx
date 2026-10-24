'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PiggyBank, Undo2 } from 'lucide-react';
import { PAYMENT_METHODS, type MessageKey } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { fmtDateTime, formatSom, parseSomToTiyin } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Select, Table, Td, Textarea, TextLink, Th, useToast } from '@/components/ui';
import { canTakeMoney, ShiftLoadError, useCurrentShift, type Shift } from '@/components/cash-shift';
import { MoneyInput } from '@/components/money-input';

const KIND_TONE: Record<string, 'green' | 'blue' | 'gray'> = { in: 'green', apply: 'blue', out: 'gray' };

/**
 * Cashier (or manager) takes a prepayment into the patient's deposit — in their own open shift, like a payment.
 * One idempotency key per intended deposit: a retry after a lost answer cannot record it twice.
 */
export function DepositModal({ patient, onClose }: { patient: { id: string; last_name?: string; first_name?: string }; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const shift = useCurrentShift();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const tiyin = amount.trim() ? parseSomToTiyin(amount) : null;
  const m = useMutation({
    mutationFn: () => api<{ data: { deposit: { amount: number }; replayed: boolean } }>(`/patients/${patient.id}/deposits`, { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: { amount: tiyin, method, note: note.trim() || null } }),
    onSuccess: (r) => {
      ['patient', 'deposits', 'cash-shift', 'cash-shifts', 'finance-summary', 'invoices'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(r.data.replayed ? t('cash.depositReplayed') : t('cash.depositSaved', { amount: formatSom(r.data.deposit.amount) }));
      onClose();
    },
    onError: (e) => {
      if (!(e instanceof ApiError && e.status === 0)) key.current = newIdempotencyKey();
      if (e instanceof ApiError && e.fields) setErrors(e.fields); else setErr((e as Error).message);
    },
  });
  const noShift = !shift.isLoading && !shift.isError && !shift.data;
  const ready = !!tiyin && tiyin > 0 && !!shift.data && !shift.data.stale;
  return (
    <Modal open onClose={onClose} dirty={!!(amount || note)} title={t('cash.depositTitle')}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!ready} onClick={() => { setErr(null); setErrors({}); m.mutate(); }}>{t('cash.depositButton')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <p className="text-sm text-slate-600">{t('cash.depositIntro')}</p>
        {shift.isError && shift.data === undefined && <ShiftLoadError q={shift} />}
        {noShift && <Alert tone="yellow" title={t('cash.shiftClosed')}>{t('cash.openShiftHint').replace('{link}', t('cash.title'))}</Alert>}
        {shift.data?.stale && <Alert tone="red">{t('cash.shiftStaleHint')}</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('cash.amountSomComma')} required error={errors.amount ?? (amount && tiyin == null ? t('cash.enterNumber') : undefined)}>{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errors.amount} data-autofocus />}</Field>
          <Field label={t('cash.paymentMethod')} required>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((k) => <option key={k} value={k}>{t(`payment.${k}` as MessageKey)}</option>)}</Select>}</Field>
        </div>
        <Field label={t('cash.note')} error={errors.note}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.optional')} />}</Field>
      </div>
    </Modal>
  );
}

/** Manager returns an unused deposit; cash comes out of an open drawer (chosen here), card/transfer are only recorded. */
function DepositRefundModal({ patientId, balance, onClose }: { patientId: string; balance: number; onClose: () => void }) {
  const t = useT();
  const { branchId, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState(String(balance / 100));
  const [method, setMethod] = useState<string>('cash');
  const [note, setNote] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const branch = branchId || me.branches[0]?.id;
  const shifts = useQuery({ queryKey: ['cash-shifts', 'open', branch], queryFn: () => api<{ data: Shift[] }>(`/cash-shifts?status=open${branch ? `&branch_id=${branch}` : ''}`).then((r) => r.data), enabled: method === 'cash' });
  const openShifts = shifts.data ?? [];
  const chosen = shiftId || (openShifts.length === 1 ? openShifts[0].id : '');
  const tiyin = amount.trim() ? parseSomToTiyin(amount) : null;
  const tooMuch = tiyin != null && tiyin > balance;
  const m = useMutation({
    mutationFn: () => api<{ data: { deposit: { amount: number } } }>(`/patients/${patientId}/deposits/refund`, { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: { amount: tiyin, method, note: note.trim(), shift_id: method === 'cash' ? chosen || undefined : undefined } }),
    onSuccess: (r) => {
      ['patient', 'deposits', 'cash-shift', 'cash-shifts', 'finance-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(t('cash.depositRefunded', { amount: formatSom(r.data.deposit.amount) })); onClose();
    },
    onError: (e) => {
      if (!(e instanceof ApiError && e.status === 0)) key.current = newIdempotencyKey();
      if (e instanceof ApiError && e.fields) setErrors(e.fields); else setErr((e as Error).message);
    },
  });
  const ready = !!tiyin && tiyin > 0 && !tooMuch && note.trim().length >= 3 && (method !== 'cash' || !!chosen);
  return (
    <Modal open onClose={onClose} dirty={!!note.trim()} title={t('cash.depositRefundTitle')}
      footer={<><ModalCancel /><Button variant="danger" loading={m.isPending} disabled={!ready} onClick={() => { setErr(null); setErrors({}); m.mutate(); }}>{t('cash.depositRefund')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('cash.amountSomComma')} required hint={t('cash.refundableHint', { max: formatSom(balance) })} error={errors.amount ?? (tooMuch ? t('cash.atMost', { max: formatSom(balance) }) : undefined)}>{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} invalid={tooMuch || !!errors.amount} />}</Field>
          <Field label={t('cash.refundMethod')} required>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((k) => <option key={k} value={k}>{t(`payment.${k}` as MessageKey)}</option>)}</Select>}</Field>
        </div>
        {method === 'cash' && (shifts.isError && !shifts.data ? <ShiftLoadError q={shifts} />
          : openShifts.length === 0 && !shifts.isLoading ? <Alert tone="yellow" title={t('cash.noOpenDrawer')}>{t('cash.noOpenDrawerText')}</Alert>
          : <Field label={t('cash.fromDrawer')} required error={errors.shift_id}>{(id) => <Select id={id} value={chosen} onChange={(e) => setShiftId(e.target.value)}>
              {openShifts.length > 1 && <option value="">{t('cash.choose')}</option>}
              {openShifts.map((s) => <option key={s.id} value={s.id}>{t('cash.shiftOptionShort', { n: s.number, cashier: s.cashier_name })}</option>)}
            </Select>}</Field>)}
        <Field label={t('cash.note')} required error={errors.note}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {!ready && <p className="text-sm text-slate-600">{t('cash.fillRequired')}</p>}
      </div>
    </Modal>
  );
}

/** The patient's deposit: balance, movements (newest first) and — for the manager — the refund of what is left. */
export function DepositCard({ patientId }: { patientId: string }) {
  const t = useT();
  const { me } = useSession();
  const [refunding, setRefunding] = useState(false);
  const q = useQuery({ queryKey: ['deposits', patientId], queryFn: () => api<{ data: any[]; meta: { balance: number } }>(`/patients/${patientId}/deposits`) });
  if (q.isLoading) return <LoadingRows rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const balance = Number(q.data!.meta.balance);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-body font-bold text-slate-900"><PiggyBank className="h-4 w-4 text-brand-600" />{t('cash.depositHistory')}<Badge tone={balance > 0 ? 'green' : 'gray'}>{formatSom(balance)}</Badge></h3>
        {me.role === 'manager' && balance > 0 && <Button size="sm" icon={<Undo2 className="h-4 w-4" />} onClick={() => setRefunding(true)}>{t('cash.depositRefund')}</Button>}
      </div>
      {!q.data!.data.length ? <EmptyState compact title={t('cash.depositEmpty')} /> : (
        <Table>
          <thead><tr><Th>{t('cash.colTime')}</Th><Th>{t('cash.colWhat')}</Th><Th className="hidden sm:table-cell">{t('cash.colMethod')}</Th><Th right>{t('cash.colSum')}</Th></tr></thead>
          <tbody>{q.data!.data.map((d) => (
            <tr key={d.id}>
              <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(d.occurred_at)}<div className="text-small text-slate-600">{d.actor_name}</div></Td>
              <Td><Badge tone={KIND_TONE[d.kind]}>{t(`cash.depositKind.${d.kind}` as MessageKey)}</Badge>{d.invoice_id && <TextLink href={`/cashier/${d.invoice_id}`} className="ml-2 whitespace-nowrap">№{d.invoice_number}</TextLink>}{d.note && <div className="text-small text-slate-600">{d.note}</div>}</Td>
              <Td className="hidden sm:table-cell">{d.method ? t(`payment.${d.method}` as MessageKey) : '—'}{d.shift_number ? <div className="text-small text-slate-600">{t('cash.shiftNo', { n: d.shift_number })}</div> : null}</Td>
              <Td right className={cx('font-medium tabular-nums', d.kind === 'in' ? 'text-emerald-800' : 'text-slate-800')}>{d.kind === 'in' ? '+' : '−'}{formatSom(d.amount)}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {refunding && <DepositRefundModal patientId={patientId} balance={balance} onClose={() => setRefunding(false)} />}
    </section>
  );
}

export const canDeposit = (role: string) => canTakeMoney(role);
