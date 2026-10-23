'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Field, Input, Modal, ModalCancel, useToast } from '@/components/ui';

/**
 * Fiscal receipt (ОФД) of a payment or refund. Parallel mode («manual»): the clinic's certified KKM prints the
 * receipt and the cashier types its number here. Nothing is shown for a clinic without fiscalisation («none»).
 */
export type Fiscal = { id: string; status: 'pending' | 'issued' | 'failed' | 'skipped'; provider: string; receipt_number: string | null; fiscal_sign: string | null; qr_url: string | null; terminal_id: string | null; issued_at: string | null; entered_by_name: string | null; error: string | null } | null;

/** Whether this clinic owes fiscal receipts at all (hides every fiscal control for the demo clinics). */
export function useFiscalEnabled() {
  const { me } = useSession();
  return me.fiscal_provider !== 'none';
}

export function FiscalBadge({ f }: { f: Fiscal }) {
  const t = useT();
  if (!f || f.status === 'skipped') return null;
  if (f.status === 'issued') return <Badge tone="green" icon={<ReceiptText className="h-3.5 w-3.5" />}>{t('cash.fiscal.issued', { n: f.receipt_number })}</Badge>;
  if (f.status === 'failed') return <Badge tone="red">{t('cash.fiscal.failed')}</Badge>;
  return <Badge tone="yellow">{t('cash.fiscal.pending')}</Badge>;
}

/** May this person type the receipt in? Cashier: own payments; manager: any (the server enforces the same). */
export function canEnterFiscal(me: { role: string; membership_id: string }, f: Fiscal, kind: 'payment' | 'refund', cashierMembershipId?: string | null) {
  if (!f || (f.status !== 'pending' && f.status !== 'failed')) return false;
  if (me.role === 'manager') return true;
  return kind === 'payment' && me.role === 'cashier' && cashierMembershipId === me.membership_id;
}

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => ['invoices', 'payments', 'cash-shift', 'cash-shifts', 'finance-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

/** The entry form itself: receipt number required, the rest optional (used inline after a payment and in the modal). */
export function FiscalEnterForm({ kind, id, onDone, compact }: { kind: 'payment' | 'refund'; id: string; onDone?: () => void; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [qr, setQr] = useState('');
  const [sign, setSign] = useState('');
  const [terminal, setTerminal] = useState('');
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/${kind === 'payment' ? 'payments' : 'refunds'}/${id}/fiscal`, { method: 'POST', body: { receipt_number: number.trim(), qr_url: qr.trim() || null, fiscal_sign: sign.trim() || null, terminal_id: terminal.trim() || null } }),
    onSuccess: (r: any) => { invalidateAll(qc); toast.success(t('cash.fiscal.saved', { n: r.data.receipt_number })); onDone?.(); },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) { setErr(e.fields); setError(null); return; }
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) invalidateAll(qc);
    },
  });
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!number.trim()) { setErr({ receipt_number: t('cash.fiscal.numberHint') }); return; } setErr({}); m.mutate(); };
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {error && <Alert tone="red">{error}</Alert>}
      <Field label={t('cash.fiscal.number')} required error={err.receipt_number} hint={compact ? undefined : t('cash.fiscal.numberHint')}>{(fid) => <Input id={fid} data-autofocus value={number} inputMode="numeric" autoComplete="off" invalid={!!err.receipt_number} maxLength={60} onChange={(e) => { setNumber(e.target.value); setErr({}); }} />}</Field>
      <Field label={t('cash.fiscal.qr')} error={err.qr_url}>{(fid) => <Input id={fid} type="url" value={qr} invalid={!!err.qr_url} placeholder="https://" maxLength={500} onChange={(e) => setQr(e.target.value)} />}</Field>
      {more ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('cash.fiscal.sign')} error={err.fiscal_sign}>{(fid) => <Input id={fid} value={sign} invalid={!!err.fiscal_sign} maxLength={80} onChange={(e) => setSign(e.target.value)} />}</Field>
          <Field label={t('cash.fiscal.terminal')} error={err.terminal_id}>{(fid) => <Input id={fid} value={terminal} invalid={!!err.terminal_id} maxLength={60} onChange={(e) => setTerminal(e.target.value)} />}</Field>
        </div>
      ) : <button type="button" className="min-h-9 text-[0.9375rem] font-semibold text-brand-700 hover:underline" onClick={() => setMore(true)}>{t('cash.fiscal.sign')} / {t('cash.fiscal.terminal')}</button>}
      <Button type="submit" variant="primary" className={compact ? undefined : 'w-full'} loading={m.isPending} icon={<ReceiptText className="h-4 w-4" />}>{t('cash.fiscal.save')}</Button>
    </form>
  );
}

export function FiscalEnterModal({ kind, id, label, onClose }: { kind: 'payment' | 'refund'; id: string; label: string; onClose: () => void }) {
  const t = useT();
  return (
    <Modal open onClose={onClose} title={`${t('cash.fiscal.title')} — ${label}`} footer={<ModalCancel />}>
      <FiscalEnterForm kind={kind} id={id} onDone={onClose} />
    </Modal>
  );
}
