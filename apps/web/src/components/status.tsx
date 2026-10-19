import type { MessageKey } from '@meduza/contracts';
import { useT } from '@/lib/i18n';
import { Ban, CheckCheck, CheckCircle2, CircleDashed, Clock, FlaskConical, Hourglass, PlayCircle, Send, UserCheck, UserX, Wallet } from 'lucide-react';
import { Badge, Tone } from './ui';

const ic = 'h-3.5 w-3.5';
/** Booked through Telegram / patient confirmed they will come (from a reminder). */
export function SourceMark({ appt }: { appt: { source?: string; patient_confirmed_at?: string | null; status?: string } }) {
  const t = useT();
  if (appt.source !== 'telegram' && !appt.patient_confirmed_at) return null;
  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle">
      {appt.source === 'telegram' && <span title={t('source.telegram')} aria-label={t('source.telegramShort')} className="inline-flex items-center rounded bg-sky-50 px-1 py-px text-[0.625rem] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200"><Send className="mr-0.5 h-2.5 w-2.5" />TG</span>}
      {appt.patient_confirmed_at && appt.status === 'scheduled' && <span title={t('source.confirmed')} aria-label={t('source.confirmedShort')} className="inline-flex text-emerald-600"><CheckCheck className="h-3.5 w-3.5" /></span>}
    </span>
  );
}
export function AppointmentStatus({ status }: { status: string }) {
  const t = useT();
  const map: Record<string, [Tone, React.ReactNode]> = {
    scheduled: ['blue', <Clock key="i" className={ic} />], arrived: ['yellow', <UserCheck key="i" className={ic} />], in_progress: ['violet', <PlayCircle key="i" className={ic} />],
    completed: ['green', <CheckCircle2 key="i" className={ic} />], cancelled: ['gray', <Ban key="i" className={ic} />], no_show: ['red', <UserX key="i" className={ic} />],
  };
  const [tone, icon] = map[status] ?? ['gray', null];
  return <Badge tone={tone} icon={icon}>{map[status] ? t(`status.appointment.${status}` as MessageKey) : status}</Badge>;
}
export function InvoiceStatus({ status }: { status: string }) {
  const t = useT();
  const map: Record<string, Tone> = { unpaid: 'red', partially_paid: 'yellow', paid: 'green', refunded: 'blue', void: 'gray' };
  return <Badge tone={map[status] ?? 'gray'} icon={status === 'paid' ? <CheckCircle2 className={ic} /> : status === 'void' ? <Ban className={ic} /> : <Wallet className={ic} />}>{map[status] ? t(`status.invoice.${status}` as MessageKey) : status}</Badge>;
}
export function LabStatus({ status, short }: { status: string; short?: boolean }) {
  const t = useT();
  const map: Record<string, [Tone, React.ReactNode]> = {
    ordered: ['blue', <CircleDashed key="i" className={ic} />], sample_collected: ['yellow', <FlaskConical key="i" className={ic} />],
    draft_result: ['yellow', <Hourglass key="i" className={ic} />], verified: ['green', <CheckCircle2 key="i" className={ic} />], cancelled: ['gray', <Ban key="i" className={ic} />],
    completed: ['green', <CheckCircle2 key="i" className={ic} />],
  };
  const [tone, icon] = map[status] ?? ['gray', null];
  const label = short && status !== 'verified' && status !== 'completed' ? t('status.lab.notReady') : map[status] ? t(`status.lab.${status}` as MessageKey) : status;
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
}
export function NoteStatus({ status }: { status: string | null }) {
  const t = useT();
  if (!status) return <Badge>{t('status.note.none')}</Badge>;
  return status === 'signed' ? <Badge tone="green" icon={<CheckCircle2 className={ic} />}>{t('status.note.signed')}</Badge> : <Badge tone="yellow" icon={<Hourglass className={ic} />}>{t('status.note.draft')}</Badge>;
}
