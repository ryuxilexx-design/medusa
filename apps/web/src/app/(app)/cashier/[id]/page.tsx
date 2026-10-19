'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, Percent, Printer, Undo2, Wallet } from 'lucide-react';
import { REFUND_REASON_LABEL, PAYMENT_METHOD_LABEL, SERVICE_CATEGORY_LABEL } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { fmtDateTime, formatSom, fullName, parseSomToTiyin, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useUnsavedGuard } from '@/lib/unsaved';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, KeyVal, LoadingRows, Modal, Select, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { AppointmentStatus, InvoiceStatus } from '@/components/status';
import { useCurrentShift } from '@/components/cash-shift';
import { RefundModal } from '@/components/refund-modal';

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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
      <Link href="/cashier" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />Hisoblar ro‘yxati</Link>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2">Hisob №{inv.invoice_number} <InvoiceStatus status={inv.status} /></span>}
            actions={<>
              {me.role === 'manager' && inv.status === 'unpaid' && inv.paid_amount === 0 && <Button size="sm" icon={<Percent className="h-3.5 w-3.5" />} onClick={() => setDiscount(true)}>Chegirma</Button>}
              {(me.role === 'manager' || me.role === 'cashier') && inv.status === 'unpaid' && inv.paid_amount === 0 && <Button size="sm" variant="danger" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setVoiding(true)}>Bekor qilish</Button>}
              {me.role === 'manager' && inv.status !== 'void' && Number(inv.paid_amount) > 0 && <Button size="sm" variant="danger" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setRefunding(true)}>Pulni qaytarish</Button>}
            </>}>
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <div className="divide-y divide-slate-100">
                <KeyVal k="Bemor" v={<Link href={`/patients/${inv.patient_id}`} className="text-brand-700 hover:underline">{fullName(inv, true)} {pid(inv.patient_number)}</Link>} />
                <KeyVal k="Filial" v={inv.branch_name} />
                <KeyVal k="Yaratilgan" v={fmtDateTime(inv.created_at)} />
              </div>
              <div className="divide-y divide-slate-100">
                {inv.appointment_at && <KeyVal k="Qabul" v={<span className="inline-flex items-center gap-2">{fmtDateTime(inv.appointment_at)} <AppointmentStatus status={inv.appointment_status} /></span>} />}
                {inv.doctor_name && <KeyVal k="Shifokor" v={inv.doctor_name} />}
                {inv.discount_amount > 0 && <KeyVal k="Chegirma" v={`${inv.discount_type === 'percent' ? inv.discount_value + '%' : formatSom(inv.discount_value)} · ${inv.discount_reason} (${inv.discount_approved_by_name})`} />}
              </div>
            </div>
            {inv.appointment_status === 'cancelled' && <div className="mt-3"><Alert>Qabul bekor qilingan. {inv.paid_amount > 0 ? 'Hisobda to‘lov bor — pul avtomatik qaytarilmaydi. Rahbar «Pulni qaytarish» orqali qaytaradi.' : 'To‘lov bo‘lmasa, hisobni sabab bilan bekor qilish mumkin.'}</Alert></div>}
            {inv.status === 'void' && <div className="mt-3"><Alert tone="blue">Bekor qilingan hisob: {inv.void_reason}</Alert></div>}
          </Card>
          <Card title="Xizmatlar" padded={false}>
            <Table>
              <thead><tr><Th>Xizmat</Th><Th>Turi</Th><Th right>Miqdor</Th><Th right>Narx</Th><Th right>Chegirma</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {inv.items.map((it: any) => (
                  <tr key={it.id}><Td>{it.description}</Td><Td><Badge>{SERVICE_CATEGORY_LABEL[it.category]}</Badge></Td><Td right>{it.quantity}</Td><Td right>{formatSom(it.unit_price)}</Td><Td right>{it.discount_share ? `−${formatSom(it.discount_share)}` : '—'}</Td><Td right className="font-medium">{formatSom(it.line_total)}</Td></tr>
                ))}
                <tr className="bg-slate-50"><Td className="font-medium">Jami</Td><Td /><Td /><Td right>{formatSom(inv.subtotal)}</Td><Td right>{inv.discount_amount ? `−${formatSom(inv.discount_amount)}` : '—'}</Td><Td right className="font-semibold">{formatSom(inv.total)}</Td></tr>
              </tbody>
            </Table>
            <p className="px-4 py-2 text-xs text-slate-500">Narxlar xizmat buyurtma qilingan paytdagi snapshot; katalog o‘zgarsa bu hisob o‘zgarmaydi.</p>
          </Card>
          <Card title="To‘lovlar" padded={false}>
            {!inv.payments.length ? <p className="px-4 py-4 text-sm text-slate-500">Hali to‘lov qayd etilmagan.</p> : (
              <Table>
                <thead><tr><Th>Qayd №</Th><Th>Vaqt</Th><Th>Usul</Th><Th>Kassir</Th><Th right>Summa</Th><Th right>Hujjat</Th></tr></thead>
                <tbody>{inv.payments.map((p: any) => (
                  <tr key={p.id}><Td className="tabular-nums">{p.receipt_number}</Td><Td>{fmtDateTime(p.paid_at)}</Td><Td>{PAYMENT_METHOD_LABEL[p.method]}</Td><Td>{p.cashier_name}</Td><Td right className="font-medium">{formatSom(p.amount)}</Td>
                    <Td right><Link href={`/print/payment/${p.id}`} target="_blank" className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand-700 hover:underline"><Printer className="h-3.5 w-3.5" />Ichki qayd</Link></Td></tr>
                ))}</tbody>
              </Table>
            )}
            <p className="px-4 py-2 text-xs text-slate-500">To‘lov yozuvlari o‘chirilmaydi (append-only). Chop etiladigan hujjat — ichki to‘lov qaydi, fiskal chek emas.</p>
          </Card>
          {inv.refunds?.length > 0 && (
            <Card title="Qaytarishlar" padded={false}>
              <Table>
                <thead><tr><Th>№</Th><Th>Vaqt</Th><Th>Usul</Th><Th>Sabab</Th><Th>Tasdiqladi</Th><Th right>Summa</Th></tr></thead>
                <tbody>{inv.refunds.map((r: any) => (
                  <tr key={r.id}><Td className="tabular-nums">{r.refund_number}</Td><Td>{fmtDateTime(r.refunded_at)}</Td><Td>{PAYMENT_METHOD_LABEL[r.method]}</Td>
                    <Td>{REFUND_REASON_LABEL[r.reason_code]}<span className="block text-xs text-slate-500">{r.reason}</span></Td><Td>{r.approved_by_name}</Td><Td right className="font-medium text-red-700">−{formatSom(r.amount)}</Td></tr>
                ))}</tbody>
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card>
            <div className="space-y-1">
              {Number(inv.credit_amount) > 0 && <KeyVal k="Qaytarilgan (hisobdan ayrilgan)" v={<span className="text-red-700">−{formatSom(inv.credit_amount)}</span>} />}
              <KeyVal k="Hisob jami" v={formatSom(inv.total)} />
              <KeyVal k="To‘langan" v={<span className="text-emerald-700">{formatSom(inv.paid_amount)}</span>} />
              <div className="flex items-baseline justify-between border-t border-slate-100 pt-2"><span className="text-sm text-slate-600">Qoldiq</span><span className="text-2xl font-semibold tabular-nums text-slate-900">{inv.status === 'void' ? '—' : formatSom(inv.due)}</span></div>
            </div>
          </Card>
          {me.role === 'cashier' && open && <CashierPay inv={inv} />}
          {me.role === 'cashier' && inv.status === 'paid' && <Alert tone="green" title="Hisob to‘liq to‘langan">Yangi xizmat buyurilsa, u alohida hisobga tushadi.</Alert>}
          {me.role !== 'cashier' && open && <Alert tone="blue">To‘lovni kassir qayd qiladi. Rahbar kuzatadi va chegirmani tasdiqlaydi.</Alert>}
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
  const shift = useCurrentShift();
  if (shift.isLoading) return null;
  if (!shift.data) return <Alert tone="yellow" title="Smena yopiq">To‘lov qabul qilish uchun <Link href="/cashier" className="font-medium underline">Kassa</Link> sahifasida smenani oching.</Alert>;
  if (shift.data.branch_id !== inv.branch_id) return <Alert tone="yellow" title="Smena boshqa filialda">Smenangiz «{shift.data.branch_name}» filialida. Bu hisob «{inv.branch_name}» filialiga tegishli.</Alert>;
  return <PaymentForm inv={inv} />;
}

function PaymentForm({ inv }: { inv: any }) {
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
      toast.success(r.data.replayed ? `To‘lov avvalroq qayd etilgan ekan (qayd №${r.data.payment.receipt_number}) — ikkinchi marta yozilmadi` : `To‘lov qayd etildi: ${formatSom(r.data.payment.amount)}`);
    },
    onError: (e, body) => {
      if (e instanceof ApiError && e.status === 0) {
        setPending(body);
        setError('Server javobi olinmadi. To‘lov yozilgan yoki yozilmaganini bilmaymiz. Aloqa tiklangach «Shu to‘lovni qayta yuborish» ni bosing — xuddi shu kalit bilan yuboriladi, dublikat yaratilmaydi.');
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
    const t = parseSomToTiyin(amount);
    if (t == null || t <= 0) { setFieldErr('Summa 0 dan katta son bo‘lsin'); return; }
    if (t > inv.due) { setFieldErr(`Summa qoldiqdan (${formatSom(inv.due)}) oshmasligi kerak`); return; }
    setFieldErr(null); setError(null);
    m.mutate({ amount: t, method, note: note || null });
  }
  function abandon() {
    // user gives up on the unknown request: reload the invoice to see whether it landed, then start fresh
    key.current = newIdempotencyKey(); setPending(null); setError(null);
    qc.invalidateQueries({ queryKey: ['invoices'] });
    toast.info('Hisob yangilandi. To‘lovlar ro‘yxatini tekshiring: oldingi so‘rov yozilgan bo‘lsa, u ro‘yxatda ko‘rinadi.');
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" />To‘lovni qayd qilish</span>}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {error && <Alert tone={pending ? 'yellow' : 'red'}>{error}</Alert>}
        {last && !pending && <Alert tone="green" title={`Qayd №${last.receipt_number}: ${formatSom(last.amount)}`}><Link href={`/print/payment/${last.id}`} target="_blank" className="font-medium underline">Ichki to‘lov qaydini chop etish</Link></Alert>}
        <Field label="Summa (so‘m)" required error={fieldErr ?? undefined} hint={`Qoldiq: ${formatSom(inv.due)}. Qisman to‘lash mumkin.`}>{(id) => <Input id={id} inputMode="decimal" value={pending ? String(pending.amount / 100) : amount} disabled={!!pending} onChange={(e) => setAmount(e.target.value)} invalid={!!fieldErr} className="text-right text-base tabular-nums" />}</Field>
        {!pending && <div className="flex gap-1.5">
          {[inv.due, Math.floor(inv.due / 2 / 1000000) * 1000000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => <button type="button" key={v} onClick={() => setAmount(String(v / 100))} className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">{v === inv.due ? 'To‘liq' : 'Yarmi'}: {formatSom(v, false)}</button>)}
        </div>}
        <Field label="To‘lov usuli" required>{(id) => (
          <Select id={id} value={pending ? pending.method : method} disabled={!!pending} onChange={(e) => setMethod(e.target.value)}>{Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        )}</Field>
        <Field label="Izoh">{(id) => <Textarea id={id} rows={2} value={pending ? pending.note ?? '' : note} disabled={!!pending} onChange={(e) => setNote(e.target.value)} placeholder="ixtiyoriy" />}</Field>
        <Button type="submit" variant="primary" className="w-full" loading={m.isPending} icon={<CheckCircle2 className="h-4 w-4" />}>{pending ? 'Shu to‘lovni qayta yuborish' : 'To‘lovni qayd qilish'}</Button>
        {pending && <Button type="button" className="w-full" disabled={m.isPending} onClick={abandon}>Qayta yubormaslik — hisobni yangilash</Button>}
        <p className="text-xs text-slate-500">Kassir va vaqt serverda qayd etiladi. Ikki usulda to‘lash — ketma-ket ikki yozuv. Bank/fiskal integratsiya yo‘q.</p>
      </form>
    </Card>
  );
}

function DiscountModal({ inv, onClose }: { inv: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api(`/invoices/${inv.id}/discount`, { method: 'POST', body: { type, value: type === 'percent' ? Number(value.replace(',', '.')) : parseSomToTiyin(value), reason } }),
    onSuccess: () => { ['invoices', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success('Chegirma qo‘llandi'); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const num = type === 'percent' ? Number(value.replace(',', '.')) : parseSomToTiyin(value) ?? NaN;
  const valid = num > 0 && (type === 'amount' ? num <= inv.subtotal : num <= 100) && reason.trim().length >= 3;
  return (
    <Modal open onClose={onClose} dirty={!!(value || reason)} title="Chegirma (rahbar tasdig‘i)" footer={<><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Qo‘llash</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Turi">{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value as any)}><option value="percent">Foiz (0–100%)</option><option value="amount">Aniq summa</option></Select>}</Field>
          <Field label={type === 'percent' ? 'Foiz' : 'Summa (so‘m)'} required error={err.value}>{(id) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
        </div>
        <Field label="Sabab" required error={err.reason}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <p className="text-xs text-slate-500">Bir vaqtda bitta chegirma. Qatorlar bo‘yicha proporsional taqsimlanadi. To‘lov qayd etilgach hisob summasi o‘zgarmaydi.</p>
      </div>
    </Modal>
  );
}

function VoidModal({ inv, onClose }: { inv: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/invoices/${inv.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { ['invoices', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success('Hisob bekor qilindi'); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open onClose={onClose} dirty={!!reason} title={`Hisob №${inv.invoice_number} ni bekor qilish`} footer={<><Button onClick={onClose}>Ortga</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Bekor qilish</Button></>}>
      <Field label="Sabab" required>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <p className="mt-2 text-xs text-slate-500">Faqat to‘lovsiz hisob bekor qilinadi. Bekor qilingan hisob qarzdorlikka kirmaydi.</p>
    </Modal>
  );
}
