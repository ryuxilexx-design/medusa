'use client';
// «Rahbarga xabar»: one big button, a preset reason in one tap, an optional note. Creates a critical incident; the
// manager's screen shows a red banner until they mark it seen.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, Eye, Flame, Hand, HeartPulse, ShieldAlert, Siren } from 'lucide-react';
import { SOS_REASONS, type MessageKey, type SosReason } from '@meduza/contracts';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Alert, Button, cx, FOCUS_RING, Field, Modal, ModalCancel, Textarea, useToast } from '@/components/ui';
import { useWriteBranch } from './common';

const ICON: Record<SosReason, React.ElementType> = { aggression: Hand, medical: HeartPulse, fire: Flame, theft: ShieldAlert, suspicious: Eye, other: BellRing };

export function SosButton({ className }: { className?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const branchId = useWriteBranch();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SosReason | null>(null);
  const [note, setNote] = useState('');
  const close = () => { setOpen(false); setReason(null); setNote(''); };
  const m = useMutation({
    mutationFn: () => api('/security/sos', { method: 'POST', body: { branch_id: branchId || null, reason, note: note.trim() || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.sos.sent')); close(); },
    onError: (e) => toast.error(e),
  });
  return (
    <>
      <Button variant="danger" className={cx('!min-h-control px-6 text-base', className)} icon={<Siren className="h-5 w-5" />} onClick={() => setOpen(true)} data-testid="sos">{t('guard.sos.button')}</Button>
      <Modal open={open} onClose={close} dirty={!!note} title={t('guard.sos.title')}
        footer={<><ModalCancel /><Button variant="danger" icon={<Siren className="h-5 w-5" />} disabled={!reason} loading={m.isPending} onClick={() => m.mutate()}>{t('guard.sos.send')}</Button></>}>
        <div className="space-y-4">
          {!branchId && <Alert tone="yellow">{t('guard.branchPick')}</Alert>}
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-800">{t('guard.sos.pick')}</legend>
            <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
              {SOS_REASONS.map((r) => {
                const Icon = ICON[r];
                const on = reason === r;
                return (
                  <button key={r} type="button" aria-pressed={on} onClick={() => setReason(r)} data-reason={r} data-autofocus={r === SOS_REASONS[0] || undefined}
                    className={cx('press flex min-h-[3.5rem] items-center gap-3 rounded-field border-2 px-3 text-left text-body font-semibold', FOCUS_RING,
                      on ? 'border-red-600 bg-red-50 text-red-900' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400')}>
                    <Icon className={cx('h-6 w-6 shrink-0', on ? 'text-red-700' : 'text-slate-600')} aria-hidden="true" />{t(`guard.sos.reason.${r}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Field label={t('guard.noteOptional')} hint={t('guard.noNames')}>{(id) => <Textarea id={id} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <p className="text-small font-semibold text-slate-700">{t('guard.sos.call')}</p>
        </div>
      </Modal>
    </>
  );
}
