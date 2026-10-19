'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHOD_LABEL, REFUND_REASON_LABEL } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { formatSom, parseSomToTiyin } from '@/lib/format';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import type { Shift } from '@/components/cash-shift';

/**
 * Manager refund: choose the payment, amount (≤ what is still refundable), method and reason. Cash is paid out of an
 * open drawer in the invoice's branch. The invoice is reduced by the same amount, so no debt appears.
 * One idempotency key per intended refund: a retried request cannot pay out twice.
 */
export function RefundModal({ inv, onClose }: { inv: any; onClose: () => void }) {
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
      toast.success(r.data.replayed ? 'Qaytarish avvalroq yozilgan ekan — ikkinchi marta berilmadi' : `Qaytarish №${r.data.refund.refund_number} yozildi`);
      onClose();
    },
    onError: (e) => {
      // the server answered: the next attempt is a new request; a lost response keeps the key (safe retry)
      if (!(e instanceof ApiError && e.status === 0)) key.current = newIdempotencyKey();
      if (e instanceof ApiError && e.fields) setErrors(e.fields); else setErr((e as Error).message);
    },
  });

  if (!payable.length) return (
    <Modal open onClose={onClose} title="Pulni qaytarish" footer={<Button onClick={onClose}>Yopish</Button>}><p className="text-sm text-slate-600">Bu hisob bo‘yicha qaytariladigan to‘lov yo‘q.</p></Modal>
  );
  const ready = !!paymentId && tiyin != null && tiyin > 0 && !tooMuch && reason.trim().length >= 3 && (method !== 'cash' || !!chosenShift);
  return (
    <Modal open onClose={onClose} dirty={!!reason} title={`Hisob №${inv.invoice_number}: pulni qaytarish`}
      footer={<><Button onClick={onClose}>Bekor qilish</Button><Button variant="danger" loading={m.isPending} disabled={!ready} onClick={() => { setErr(null); setErrors({}); m.mutate(); }}>Qaytarish</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <p className="text-sm text-slate-600">Qaytarilgan summa hisobdan ham ayriladi — qarz paydo bo‘lmaydi. Qaytarish o‘chirilmaydi va audit jurnalida turadi.</p>
        <Field label="Qaysi to‘lovdan" required error={errors.payment_id}>
          {(id) => <Select id={id} value={paymentId} onChange={(e) => { setPaymentId(e.target.value); const p = payable.find((x) => x.id === e.target.value); if (p) { setAmount(String(Number(p.refundable) / 100)); setMethod(p.method); } }}>
            {payable.map((p) => <option key={p.id} value={p.id}>Qayd №{p.receipt_number} · {PAYMENT_METHOD_LABEL[p.method]} · {formatSom(p.amount)} (qaytarish mumkin: {formatSom(Number(p.refundable))})</option>)}
          </Select>}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Summa, so‘m" required error={errors.amount ?? (tooMuch ? `Ko‘pi bilan ${formatSom(max)}` : amount && tiyin == null ? 'Raqam kiriting' : undefined)}>
            {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={tooMuch} />}
          </Field>
          <Field label="Qanday qaytariladi" required>
            {(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
          </Field>
        </div>
        {method === 'cash' && (
          openShifts.length === 0 && !shifts.isLoading
            ? <Alert tone="yellow" title="Bu filialda ochiq kassa yo‘q">Naqd pul kassadan beriladi — kassir smenani ochgach qaytaring yoki karta/o‘tkazma tanlang.</Alert>
            : <Field label="Qaysi kassadan" required error={errors.shift_id}>
                {(id) => <Select id={id} value={chosenShift} onChange={(e) => setShiftId(e.target.value)}>
                  {openShifts.length > 1 && <option value="">— tanlang —</option>}
                  {openShifts.map((s) => <option key={s.id} value={s.id}>Smena №{s.number} · {s.cashier_name} · kassada {formatSom(s.expected_cash)}</option>)}
                </Select>}
              </Field>
        )}
        <Field label="Sabab" required>
          {(id) => <Select id={id} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>{Object.entries(REFUND_REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        </Field>
        <Field label="Izoh" required error={errors.reason}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: UZI apparati ishlamadi, tekshiruv o‘tkazilmadi" />}</Field>
      </div>
    </Modal>
  );
}
