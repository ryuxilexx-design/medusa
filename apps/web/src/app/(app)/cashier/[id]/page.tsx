'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, Percent, Printer, Undo2, Wallet } from 'lucide-react';
import { PAYMENT_METHOD_LABEL, type MessageKey } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { fmtDateTime, formatSom, fullName, parseSomToTiyin, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { useUnsavedGuard } from '@/lib/unsaved';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, KeyVal, LinkButton, LoadingRows, Modal, Select, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { AppointmentStatus, InvoiceStatus } from '@/components/status';
import { useCurrentShift } from '@/components/cash-shift';
import { RefundModal } from '@/components/refund-modal';
import { MoneyInput } from '@/components/money-input';

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { me } = useSession();
  const q = useQuery({ queryKey: ['invoices', 'one', id], queryFn: () => api(`/invoices/${id}`).then((r) => r.data) });
  const [discount, setDiscount] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [refunding, setRefunding] = useState(false);
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const inv = q.data;
  const open = ['unpaid', 'partially_paid'].includes(inv.status);
  return (
    <>
      <Link href="/cashier" className="mb-3 flex w-fit min-h-9 items-center gap-1 rounded-lg text-sm font-semibold text-slate-700 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"><ArrowLeft className="h-4 w-4" />{t('cash.backToList')}</Link>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card title={<span className="flex items-center gap-2">{t('cash.invoiceNo', { n: inv.invoice_number })} <InvoiceStatus status={inv.status} /></span>}
            actions={<>
              {me.role === 'manager' && inv.status === 'unpaid' && inv.paid_amount === 0 && <Button size="sm" icon={<Percent className="h-3.5 w-3.5" />} onClick={() => setDiscount(true)}>{t('cash.discount')}</Button>}
              {(me.role === 'manager' || me.role === 'cashier') && inv.status === 'unpaid' && inv.paid_amount === 0 && <Button size="sm" variant="danger" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setVoiding(true)}>{t('cash.voidInvoice')}</Button>}
              {me.role === 'manager' && inv.status !== 'void' && Number(inv.paid_amount) > 0 && <Button size="sm" variant="danger" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setRefunding(true)}>{t('cash.refund')}</Button>}
            </>}>
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <div className="divide-y divide-slate-100">
                <KeyVal k={t('cash.colPatient')} v={<Link href={`/patients/${inv.patient_id}`} className="text-brand-700 hover:underline">{fullName(inv, true)} {pid(inv.patient_number)}</Link>} />
                <KeyVal k={t('cash.branch')} v={inv.branch_name} />
                <KeyVal k={t('cash.created')} v={<span className="whitespace-nowrap tabular-nums">{fmtDateTime(inv.created_at)}</span>} />
              </div>
              <div className="divide-y divide-slate-100">
                {inv.appointment_at && <KeyVal k={t('cash.appointment')} v={<span className="inline-flex flex-wrap items-center justify-end gap-2"><span className="whitespace-nowrap tabular-nums">{fmtDateTime(inv.appointment_at)}</span> <AppointmentStatus status={inv.appointment_status} /></span>} />}
                {inv.doctor_name && <KeyVal k={t('role.doctor')} v={inv.doctor_name} />}
                {inv.discount_amount > 0 && <KeyVal k={t('cash.discount')} v={`${inv.discount_type === 'percent' ? inv.discount_value + '%' : formatSom(inv.discount_value)}, ${inv.discount_reason} (${inv.discount_approved_by_name})`} />}
              </div>
            </div>
            {inv.appointment_status === 'cancelled' && <div className="mt-3"><Alert>{inv.paid_amount > 0 ? t('cash.cancelledApptPaid') : t('cash.cancelledApptUnpaid')}</Alert></div>}
            {inv.status === 'void' && <div className="mt-3"><Alert tone="blue">{t('cash.voidedInvoice', { reason: inv.void_reason })}</Alert></div>}
          </Card>
          <Card title={t('cash.colServices')} padded={false}>
            <Table>
              <thead><tr><Th>{t('cash.colService')}</Th><Th className="hidden 2xl:table-cell">{t('cash.colType')}</Th><Th right>{t('cash.colQty')}</Th><Th right>{t('cash.colPrice')}</Th><Th right>{t('cash.discount')}</Th><Th right>{t('cash.colSum')}</Th></tr></thead>
              <tbody>
                {inv.items.map((it: any) => (
                  <tr key={it.id}><Td>{it.description}<div className="mt-1 2xl:hidden"><Badge>{t(`service.${it.category}` as MessageKey)}</Badge></div></Td><Td className="hidden 2xl:table-cell"><Badge>{t(`service.${it.category}` as MessageKey)}</Badge></Td><Td right>{it.quantity}</Td><Td right>{formatSom(it.unit_price)}</Td><Td right>{it.discount_share ? `−${formatSom(it.discount_share)}` : '—'}</Td><Td right className="font-medium">{formatSom(it.line_total)}</Td></tr>
                ))}
                <tr className="bg-slate-50"><Td className="font-medium">{t('cash.colTotal')}</Td><Td className="hidden 2xl:table-cell" /><Td /><Td right>{formatSom(inv.subtotal)}</Td><Td right>{inv.discount_amount ? `−${formatSom(inv.discount_amount)}` : '—'}</Td><Td right className="font-semibold">{formatSom(inv.total)}</Td></tr>
              </tbody>
            </Table>
            <p className="px-4 py-2 text-xs text-slate-600">{t('cash.priceSnapshot')}</p>
          </Card>
          <Card title={t('cash.payments')} padded={false}>
            {!inv.payments.length ? <p className="px-4 py-4 text-sm text-slate-600">{t('cash.noPayments')}</p> : (
              <Table>
                <thead><tr><Th>{t('cash.colReceipt')}</Th><Th>{t('cash.colTime')}</Th><Th>{t('cash.colMethod')}</Th><Th right>{t('cash.colSum')}</Th><Th right>{t('cash.colDoc')}</Th></tr></thead>
                <tbody>{inv.payments.map((p: any) => (
                  <tr key={p.id}><Td className="tabular-nums">{p.receipt_number}</Td><Td className="whitespace-nowrap tabular-nums">{fmtDateTime(p.paid_at)}</Td><Td>{t(`payment.${p.method}` as MessageKey)}<span className="block whitespace-nowrap text-xs text-slate-600">{p.cashier_name}</span></Td><Td right className="font-medium">{formatSom(p.amount)}</Td>
                    <Td right><LinkButton size="sm" variant="ghost" href={`/print/payment/${p.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('cash.internalRecord')}</LinkButton></Td></tr>
                ))}</tbody>
              </Table>
            )}
            <p className="px-4 py-2 text-xs text-slate-600">{t('cash.paymentsAppendOnly')}</p>
          </Card>
          {inv.refunds?.length > 0 && (
            <Card title={t('cash.refunds')} padded={false}>
              <Table>
                <thead><tr><Th>№</Th><Th>{t('cash.colTime')}</Th><Th>{t('cash.colMethod')}</Th><Th>{t('cash.colReason')}</Th><Th>{t('cash.colApprovedBy')}</Th><Th right>{t('cash.colSum')}</Th></tr></thead>
                <tbody>{inv.refunds.map((r: any) => (
                  <tr key={r.id}><Td className="tabular-nums">{r.refund_number}</Td><Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.refunded_at)}</Td><Td>{t(`payment.${r.method}` as MessageKey)}</Td>
                    <Td>{t(`cash.refundReason.${r.reason_code}` as MessageKey)}<span className="block text-xs text-slate-600">{r.reason}</span></Td><Td>{r.approved_by_name}</Td><Td right className="font-medium text-red-700">−{formatSom(r.amount)}</Td></tr>
                ))}</tbody>
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card>
            <div className="space-y-1">
              {Number(inv.credit_amount) > 0 && <KeyVal k={t('cash.creditLabel')} v={<span className="tabular-nums text-red-700">−{formatSom(inv.credit_amount)}</span>} />}
              <KeyVal k={t('cash.invoiceTotal')} v={<span className="tabular-nums">{formatSom(inv.total)}</span>} />
              <KeyVal k={t('cash.colPaid')} v={<span className="tabular-nums text-emerald-700">{formatSom(inv.paid_amount)}</span>} />
              <div className="flex items-baseline justify-between border-t border-slate-100 pt-2"><span className="text-sm text-slate-600">{t('cash.colDue')}</span><span className="text-2xl font-semibold tabular-nums text-slate-900">{inv.status === 'void' ? '—' : formatSom(inv.due)}</span></div>
            </div>
          </Card>
          {me.role === 'cashier' && open && <CashierPay inv={inv} />}
          {me.role === 'cashier' && inv.status === 'paid' && <Alert tone="green" title={t('cash.fullyPaidTitle')}>{t('cash.fullyPaidText')}</Alert>}
          {me.role !== 'cashier' && open && <Alert tone="blue">{t('cash.cashierTakes')}</Alert>}
        </div>
      </div>
      {discount && <DiscountModal inv={inv} onClose={() => setDiscount(false)} />}
      {voiding && <VoidModal inv={inv} onClose={() => setVoiding(false)} />}
      {refunding && <RefundModal inv={inv} onClose={() => setRefunding(false)} />}
    </>
  );
}

/** Payment is taken only in the cashier's open shift of this invoice's branch (the server enforces it too). */
function CashierPay({ inv }: { inv: any }) {
  const t = useT();
  const shift = useCurrentShift();
  if (shift.isLoading) return null;
  if (!shift.data) {
    const [before, after] = t('cash.openShiftHint').split('{link}');
    return <Alert tone="yellow" title={t('cash.shiftClosed')}>{before}<Link href="/cashier" className="font-medium underline">{t('cash.title')}</Link>{after}</Alert>;
  }
  if (shift.data.branch_id !== inv.branch_id) return <Alert tone="yellow" title={t('cash.shiftOtherBranch')}>{t('cash.shiftOtherBranchText', { shiftBranch: shift.data.branch_name, invoiceBranch: inv.branch_name })}</Alert>;
  return <PaymentForm inv={inv} />;
}

function PaymentForm({ inv }: { inv: any }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState(String(inv.due / 100));
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [last, setLast] = useState<any>(null);
  // Request whose answer was lost (network). Until resolved, only the very same request may be re-sent (same key, same body).
  const [pending, setPending] = useState<any>(null);
  // One idempotency key per intended payment: a retry after a lost response reuses it and cannot create a second payment.
  const key = useRef(newIdempotencyKey());
  useUnsavedGuard(!!pending);
  useEffect(() => { if (!pending) setAmount(String(inv.due / 100)); }, [inv.due]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: (body: any) => api(`/invoices/${inv.id}/payments`, { method: 'POST', body, headers: { 'Idempotency-Key': key.current } }),
    onSuccess: (r: any) => {
      key.current = newIdempotencyKey();
      setPending(null); setLast(r.data.payment); setError(null); setFieldErr(null); setNote('');
      ['invoices', 'payments', 'dashboard', 'patient'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(r.data.replayed ? t('cash.paymentReplayed', { receipt: r.data.payment.receipt_number }) : t('cash.paymentSaved', { amount: formatSom(r.data.payment.amount) }));
    },
    onError: (e, body) => {
      if (e instanceof ApiError && e.status === 0) {
        setPending(body);
        setError(t('cash.paymentLost'));
        return;
      }
      // the server answered: this attempt is finished, the next one is a new request
      key.current = newIdempotencyKey(); setPending(null);
      if (e instanceof ApiError && e.fields?.amount) setFieldErr(e.fields.amount);
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) { m.mutate(pending); return; }
    const tiyin = parseSomToTiyin(amount);
    if (tiyin == null || tiyin <= 0) { setFieldErr(t('cash.amountPositive')); return; }
    if (tiyin > inv.due) { setFieldErr(t('cash.amountOverDue', { due: formatSom(inv.due) })); return; }
    setFieldErr(null); setError(null);
    m.mutate({ amount: tiyin, method, note: note || null });
  }
  function abandon() {
    // user gives up on the unknown request: reload the invoice to see whether it landed, then start fresh
    key.current = newIdempotencyKey(); setPending(null); setError(null);
    qc.invalidateQueries({ queryKey: ['invoices'] });
    toast.info(t('cash.invoiceRefreshed'));
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" />{t('cash.recordPayment')}</span>}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {error && <Alert tone={pending ? 'yellow' : 'red'}>{error}</Alert>}
        {last && !pending && <Alert tone="green" title={t('cash.receiptTitle', { receipt: last.receipt_number, amount: formatSom(last.amount) })}><Link href={`/print/payment/${last.id}`} target="_blank" className="font-medium underline">{t('cash.printReceipt')}</Link></Alert>}
        <Field label={t('cash.amountSomComma')} required error={fieldErr ?? undefined} hint={t('cash.amountHint', { due: formatSom(inv.due) })}>{(id) => <MoneyInput id={id} value={pending ? String(pending.amount / 100) : amount} disabled={!!pending} onChange={(e) => { setAmount(e.target.value); setFieldErr(null); }} invalid={!!fieldErr} />}</Field>
        {!pending && <div className="flex flex-wrap gap-2">
          {[inv.due, Math.floor(inv.due / 2 / 1000000) * 1000000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => <Button type="button" size="sm" key={v} onClick={() => { setAmount(String(v / 100)); setFieldErr(null); }} className="tabular-nums">{v === inv.due ? t('cash.full') : t('cash.half')}: {formatSom(v)}</Button>)}
        </div>}
        <Field label={t('cash.paymentMethod')} required>{(id) => (
          <Select id={id} value={pending ? pending.method : method} disabled={!!pending} onChange={(e) => setMethod(e.target.value)}>{Object.keys(PAYMENT_METHOD_LABEL).map((k) => <option key={k} value={k}>{t(`payment.${k}` as MessageKey)}</option>)}</Select>
        )}</Field>
        <Field label={t('cash.note')}>{(id) => <Textarea id={id} rows={2} value={pending ? pending.note ?? '' : note} disabled={!!pending} onChange={(e) => setNote(e.target.value)} placeholder={t('common.optional')} />}</Field>
        <Button type="submit" variant="primary" className="w-full" loading={m.isPending} icon={<CheckCircle2 className="h-4 w-4" />}>{pending ? t('cash.resend') : t('cash.recordPayment')}</Button>
        {pending && <Button type="button" className="w-full" disabled={m.isPending} onClick={abandon}>{t('cash.abandon')}</Button>}
        <p className="text-xs text-slate-600">{t('cash.payFooter')}</p>
      </form>
    </Card>
  );
}

function DiscountModal({ inv, onClose }: { inv: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api(`/invoices/${inv.id}/discount`, { method: 'POST', body: { type, value: type === 'percent' ? Number(value.replace(',', '.')) : parseSomToTiyin(value), reason } }),
    onSuccess: () => { ['invoices', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('cash.discountApplied')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const num = type === 'percent' ? (/^\d+([.,]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(',', '.')) : NaN) : parseSomToTiyin(value) ?? NaN;
  const valueOk = num > 0 && (type === 'amount' ? num <= inv.subtotal : num <= 100);
  // explain an out-of-range value right away instead of silently disabling «Qo‘llash»
  const valueErr = err.value ?? (value.trim() && !valueOk ? (type === 'percent' ? t('cash.percentRange') : t('cash.atMost', { max: formatSom(inv.subtotal) })) : undefined);
  const valid = valueOk && reason.trim().length >= 3;
  return (
    <Modal open onClose={onClose} dirty={!!(value || reason)} title={t('cash.discountTitle')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>{t('cash.apply')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('cash.colType')}>{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value as any)}><option value="percent">{t('cash.percentOption')}</option><option value="amount">{t('cash.amountOption')}</option></Select>}</Field>
          <Field label={type === 'percent' ? t('cash.percent') : t('cash.amountSomComma')} required error={valueErr}>{(id) => type === 'percent'
            ? <Input id={id} inputMode="decimal" className="text-right tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} invalid={!!valueErr} />
            : <MoneyInput id={id} value={value} onChange={(e) => setValue(e.target.value)} invalid={!!valueErr} />}</Field>
        </div>
        <Field label={t('cash.colReason')} required error={err.reason}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <p className="text-xs text-slate-600">{t('cash.discountHint')}</p>
        {!valid && <p className="text-sm text-slate-600">{t('cash.fillRequired')}</p>}
      </div>
    </Modal>
  );
}

function VoidModal({ inv, onClose }: { inv: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/invoices/${inv.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { ['invoices', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('cash.invoiceVoided')); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open onClose={onClose} dirty={!!reason} title={t('cash.voidTitle', { n: inv.invoice_number })} footer={<><Button onClick={onClose}>{t('common.back')}</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>{t('cash.voidInvoice')}</Button></>}>
      <Field label={t('cash.colReason')} required>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <p className="mt-2 text-xs text-slate-600">{t('cash.voidHint')}</p>
      {reason.trim().length < 3 && <p className="mt-2 text-sm text-slate-600">{t('cash.fillRequired')}</p>}
    </Modal>
  );
}
