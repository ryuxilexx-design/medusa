'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Eraser, Printer } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { translate } from '@meduza/contracts';
import { formatLocale, formatSom } from '@/lib/format';
import { Alert, Button, Field, LinkButton, Modal, ModalCancel, Select, Textarea, useToast } from './ui';
import { useT } from '@/lib/i18n';

/**
 * Data-subject rights (ZRU-547) on the patient card: print the card (manager, registrar, doctor), download the full
 * record as a sealed JSON file and anonymise the card (manager only). The export is never rendered here — the manager
 * hands the file to the patient; the browser only saves it.
 */
export function PatientRights({ patient, role }: { patient: any; role: string }) {
  const t = useT();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const manager = role === 'manager';
  const anonymised = !!patient.anonymised_at;

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/v1/patients/${patient.id}/export.json`, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) {
        let msg = translate(formatLocale(), 'net.failed');
        try { msg = (await res.json())?.error?.message ?? msg; } catch { /* non-JSON */ }
        throw new ApiError(res.status, 'EXPORT', msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `med-uz-ai-patient-${patient.patient_number}.json`; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(t('registrar.rights.exportDone'));
    } catch (e) { toast.error(e); } finally { setDownloading(false); }
  };

  return (
    <section>
      <h3 className="mb-2 text-[0.9375rem] font-bold text-slate-900">{t('registrar.rights.title')}</h3>
      <div className="flex flex-wrap gap-2">
        <LinkButton size="sm" href={`/print/patient/${patient.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('registrar.rights.printCard')}</LinkButton>
        {manager && <Button size="sm" loading={downloading} icon={<Download className="h-4 w-4" />} onClick={download} title={t('registrar.rights.exportHint')}>{t('registrar.rights.export')}</Button>}
        {manager && !anonymised && <Button size="sm" variant="ghost" className="text-red-700" icon={<Eraser className="h-4 w-4" />} onClick={() => setConfirm(true)}>{t('registrar.rights.anonymise')}</Button>}
      </div>
      {manager && !anonymised && <AnonymiseModal open={confirm} patient={patient} onClose={() => setConfirm(false)} />}
    </section>
  );
}

function AnonymiseModal({ open, patient, onClose }: { open: boolean; patient: any; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'signed_paper' | 'verbal'>('signed_paper');
  const [blocked, setBlocked] = useState<{ debt: number; deposit_balance: number; future_appointments: any[] } | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/patients/${patient.id}/anonymise`, { method: 'POST', body: { reason, method } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient'] }); qc.invalidateQueries({ queryKey: ['patients'] }); toast.success(t('registrar.rights.done')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.code === 'ERASURE_BLOCKED') setBlocked(e.details ?? null); toast.error(e); },
  });
  return (
    <Modal open={open} onClose={onClose} dirty={!m.isPending && reason.trim().length > 0} title={t('registrar.rights.anonymiseTitle')}
      footer={<><ModalCancel /><Button variant="primary" className="!bg-red-700 hover:!bg-red-800" loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>{t('registrar.rights.confirm')}</Button></>}>
      <div className="space-y-3">
        <Alert tone="red">{t('registrar.rights.anonymiseWarn', { n: patient.patient_number })}</Alert>
        {blocked && (
          <Alert tone="yellow">
            <ul className="list-disc pl-4">
              {Number(blocked.debt) > 0 && <li>{t('registrar.rights.blockedDebt', { sum: formatSom(Number(blocked.debt)) })}</li>}
              {Number(blocked.deposit_balance) > 0 && <li>{t('registrar.rights.blockedDeposit', { sum: formatSom(Number(blocked.deposit_balance)) })}</li>}
              {blocked.future_appointments?.length > 0 && <li>{t('registrar.rights.blockedFuture', { n: blocked.future_appointments.length })}</li>}
            </ul>
          </Alert>
        )}
        <Field label={t('registrar.rights.reason')} required hint={t('registrar.rights.reasonHint')}>
          {(id) => <Textarea id={id} data-autofocus rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Field label={t('registrar.rights.method')}>
          {(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as 'signed_paper' | 'verbal')}><option value="signed_paper">{t('consent.method.signed_paper')}</option><option value="verbal">{t('consent.method.verbal')}</option></Select>}
        </Field>
      </div>
    </Modal>
  );
}
