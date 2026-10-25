'use client';
// «Rahbarga xabar»: one big button, a preset reason in one tap, an optional note. Creates a critical incident; the
// manager's screen shows a red banner until they mark it seen. Always reachable: the guard's top bar carries it on
// every page. A double tap never sends twice (in-flight guard here, Idempotency-Key + 60 s dedupe on the server).
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Eye, Flame, Hand, HeartPulse, ShieldAlert, Siren } from 'lucide-react';
import { SOS_REASONS, type MessageKey, type SosReason } from '@meduza/contracts';
import { api, newIdempotencyKey } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Alert, Button, cx, FOCUS_RING, Field, Modal, ModalCancel, Textarea, useToast } from '@/components/ui';
import { NameHint, useGuardedMutation, useWriteBranch } from './common';

const ICON: Record<SosReason, React.ElementType> = { aggression: Hand, medical: HeartPulse, fire: Flame, theft: ShieldAlert, suspicious: Eye, other: BellRing };

/** `compact`: the top bar's short red capsule (every guard page); otherwise the full-size button. */
export function SosButton({ className, compact }: { className?: string; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const branchId = useWriteBranch();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SosReason | null>(null);
  const [note, setNote] = useState('');
  // one key per opened dialog: a retry of the same «Yuborish» returns the first call
  const [key, setKey] = useState(() => newIdempotencyKey());
  const close = () => { setOpen(false); setReason(null); setNote(''); };
  const m = useGuardedMutation<{ data: { duplicate?: boolean } }>({
    mutationFn: () => api('/security/sos', { method: 'POST', body: { branch_id: branchId || null, reason, note: note.trim() || null }, headers: { 'Idempotency-Key': key } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['security'] }); if (r.data.duplicate) toast.info(t('guard.sos.already')); else toast.success(t('guard.sos.sent')); close(); },
    onError: (e) => toast.error(e),
  });
  const openDialog = () => { setKey(newIdempotencyKey()); setOpen(true); };
  return (
    <>
      {compact
        ? <Button variant="danger" size="sm" className={cx('!min-h-control-sm shrink-0 !px-3 sm:!px-4', className)} icon={<Siren className="h-5 w-5" />} onClick={openDialog} data-testid="sos" aria-label={t('guard.sos.button')}>
            <span className="hidden min-[400px]:inline">{t('guard.sos.short')}</span>
          </Button>
        : <Button variant="danger" className={cx('!min-h-control px-6 text-base', className)} icon={<Siren className="h-5 w-5" />} onClick={openDialog} data-testid="sos">{t('guard.sos.button')}</Button>}
      <Modal open={open} onClose={close} dirty={!!note} title={t('guard.sos.title')}
        footer={<><ModalCancel /><Button variant="danger" icon={<Siren className="h-5 w-5" />} disabled={!reason} loading={m.isPending} onClick={() => m.run()}>{t('guard.sos.send')}</Button></>}>
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
          <div>
            <Field label={t('guard.noteOptional')} hint={t('guard.noNames')}>{(id) => <Textarea id={id} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <NameHint text={note} />
          </div>
          <p className="text-small font-semibold text-slate-700">{t('guard.sos.call')}</p>
        </div>
      </Modal>
    </>
  );
}
