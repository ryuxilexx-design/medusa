'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHOD_LABEL, REFUND_REASON_LABEL, type MessageKey } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { formatSom, parseSomToTiyin } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Alert, Button, Field, Modal, ModalCancel, Select, Textarea, useToast } from '@/components/ui';
import { ShiftLoadError, type Shift } from '@/components/cash-shift';
import { MoneyInput } from '@/components/money-input';

/**
 * Manager refund: choose the payment, amount (≤ what is still refundable), method and reason. Cash is paid out of an
 * open drawer in the invoice's branch. The invoice is reduced by the same amount, so no debt appears.
 * One idempotency key per intended refund: a retried request cannot pay out twice.
 */
export function RefundModal({ inv, onClose }: { inv: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const payable = (inv.payments as any[]).filter((p) => Number(p.refundable) > 0);
  const [paymentId, setPaymentId] = useState(payable[0]?.id ?? '');
  const payment = payable.find((p) => p.id === paymentId);
  const [amount, setAmount] = useState(payment ? String(Number(payment.refundable) / 100) : '');
  const [method, setMethod] = useState<string>(payment?.method ?? 'cash');
  const [reasonCode, setReasonCode] = useState(inv.appointment_status === 'cancelled' ? 'appointment_cancelled' : 'service_not_provided');
  const [reason, setReason] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const shifts = useQuery({ queryKey: ['cash-shifts', 'open', inv.branch_id], queryFn: () => api<{ data: Shift[] }>(`/cash-shifts?status=open&branch_id=${inv.branch_id}`).then((r) => r.data), enabled: method === 'cash' });
  const openShifts = shifts.data ?? [];
  const chosenShift = shiftId || (openShifts.length === 1 ? openShifts[0].id : '');
  const drawer = openShifts.find((s) => s.id === chosenShift);
  const tiyin = amount.trim() ? parseSomToTiyin(amount) : null;
  const max = payment ? Number(payment.refundable) : 0;
  const tooMuch = tiyin != null && tiyin > max;

  const m = useMutation({
    mutationFn: () => api<{ data: { refund: { refund_number: number }; replayed: boolean } }>(`/invoices/${inv.id}/refunds`, {
      method: 'POST', headers: { 'Idempotency-Key': key.current },
      body: { payment_id: paymentId, amount: tiyin, method, reason_code: reasonCode, reason: reason.trim(), shift_id: method === 'cash' ? chosenShift || undefined : undefined },
    }),
    onSuccess: (r) => {
      ['invoices', 'invoice', 'payments', 'dashboard', 'cash-shift', 'cash-shifts', 'finance-summary', 'refunds'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(r.data.replayed ? t('cash.refundReplayed') : t('cash.refundSaved', { n: r.data.refund.refund_number }));
      onClose();
    },
    onError: (e) => {
      // the server answered: the next attempt is a new request; a lost response keeps the key (safe retry)
      if (!(e instanceof ApiError && e.status === 0)) key.current = newIdempotencyKey();
      if (e instanceof ApiError && e.fields) setErrors(e.fields); else setErr((e as Error).message);
    },
  });

  if (!payable.length) return (
    <Modal open onClose={onClose} title={t('cash.refund')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}><p className="text-sm text-slate-600">{t('cash.nothingToRefund')}</p></Modal>
  );
  const ready = !!paymentId && tiyin != null && tiyin > 0 && !tooMuch && reason.trim().length >= 3 && (method !== 'cash' || !!chosenShift);
  return (
    <Modal open onClose={onClose} dirty={!!reason.trim() || amount !== (payment ? String(Number(payment.refundable) / 100) : '')} title={t('cash.refundTitle', { n: inv.invoice_number })}
      footer={<><ModalCancel /><Button variant="danger" loading={m.isPending} disabled={!ready} onClick={() => { setErr(null); setErrors({}); m.mutate(); }}>{t('cash.doRefund')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <p className="text-sm text-slate-600">{t('cash.refundIntro')}</p>
        <Field label={t('cash.fromPayment')} required error={errors.payment_id}>
          {(id) => <Select id={id} value={paymentId} onChange={(e) => { setPaymentId(e.target.value); const p = payable.find((x) => x.id === e.target.value); if (p) { setAmount(String(Number(p.refundable) / 100)); setMethod(p.method); } }}>
            {payable.map((p) => <option key={p.id} value={p.id}>{t('cash.paymentOption', { receipt: p.receipt_number, method: t(`payment.${p.method}` as MessageKey), amount: formatSom(p.amount) })}</option>)}
          </Select>}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('cash.amountSomComma')} required hint={t('cash.refundableHint', { max: formatSom(max) })} error={errors.amount ?? (tooMuch ? t('cash.atMost', { max: formatSom(max) }) : amount && tiyin == null ? t('cash.enterNumber') : undefined)}>
            {(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} invalid={tooMuch || !!errors.amount} />}
          </Field>
          <Field label={t('cash.refundMethod')} required>
            {(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>{Object.keys(PAYMENT_METHOD_LABEL).map((k) => <option key={k} value={k}>{t(`payment.${k}` as MessageKey)}</option>)}</Select>}
          </Field>
        </div>
        {method === 'cash' && (
          shifts.isError && !shifts.data ? <ShiftLoadError q={shifts} />
          : openShifts.length === 0 && !shifts.isLoading
            ? <Alert tone="yellow" title={t('cash.noOpenDrawer')}>{t('cash.noOpenDrawerText')}</Alert>
            : <Field label={t('cash.fromDrawer')} required error={errors.shift_id} hint={drawer ? t('cash.drawerHint', { amount: formatSom(drawer.expected_cash) }) : undefined}>
                {(id) => <Select id={id} value={chosenShift} onChange={(e) => setShiftId(e.target.value)}>
                  {openShifts.length > 1 && <option value="">{t('cash.choose')}</option>}
                  {openShifts.map((s) => <option key={s.id} value={s.id}>{t('cash.shiftOptionShort', { n: s.number, cashier: s.cashier_name })}</option>)}
                </Select>}
              </Field>
        )}
        <Field label={t('cash.colReason')} required>
          {(id) => <Select id={id} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>{Object.keys(REFUND_REASON_LABEL).map((k) => <option key={k} value={k}>{t(`cash.refundReason.${k}` as MessageKey)}</option>)}</Select>}
        </Field>
        <Field label={t('cash.note')} required error={errors.reason}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('cash.refundNotePlaceholder')} />}</Field>
        {!ready && <p className="text-sm text-slate-600">{t('cash.fillRequired')}</p>}
      </div>
    </Modal>
  );
}
