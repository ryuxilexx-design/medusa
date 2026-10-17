import { APPOINTMENT_STATUS_LABEL, INVOICE_STATUS_LABEL, LAB_STATUS_LABEL } from '@meduza/contracts';
import { Ban, CheckCircle2, CircleDashed, Clock, FlaskConical, Hourglass, PlayCircle, UserCheck, UserX, Wallet } from 'lucide-react';
import { Badge, Tone } from './ui';

const ic = 'h-3 w-3';
export function AppointmentStatus({ status }: { status: string }) {
  const map: Record<string, [Tone, React.ReactNode]> = {
    scheduled: ['blue', <Clock key="i" className={ic} />], arrived: ['yellow', <UserCheck key="i" className={ic} />], in_progress: ['violet', <PlayCircle key="i" className={ic} />],
    completed: ['green', <CheckCircle2 key="i" className={ic} />], cancelled: ['gray', <Ban key="i" className={ic} />], no_show: ['red', <UserX key="i" className={ic} />],
  };
  const [tone, icon] = map[status] ?? ['gray', null];
  return <Badge tone={tone} icon={icon}>{APPOINTMENT_STATUS_LABEL[status as keyof typeof APPOINTMENT_STATUS_LABEL] ?? status}</Badge>;
}
export function InvoiceStatus({ status }: { status: string }) {
  const map: Record<string, Tone> = { unpaid: 'red', partially_paid: 'yellow', paid: 'green', void: 'gray' };
  return <Badge tone={map[status] ?? 'gray'} icon={status === 'paid' ? <CheckCircle2 className={ic} /> : status === 'void' ? <Ban className={ic} /> : <Wallet className={ic} />}>{INVOICE_STATUS_LABEL[status as keyof typeof INVOICE_STATUS_LABEL] ?? status}</Badge>;
}
export function LabStatus({ status, short }: { status: string; short?: boolean }) {
  const map: Record<string, [Tone, React.ReactNode]> = {
    ordered: ['blue', <CircleDashed key="i" className={ic} />], sample_collected: ['yellow', <FlaskConical key="i" className={ic} />],
    draft_result: ['yellow', <Hourglass key="i" className={ic} />], verified: ['green', <CheckCircle2 key="i" className={ic} />], cancelled: ['gray', <Ban key="i" className={ic} />],
    completed: ['green', <CheckCircle2 key="i" className={ic} />],
  };
  const [tone, icon] = map[status] ?? ['gray', null];
  const label = status === 'completed' ? 'Bajarildi' : short && status !== 'verified' ? 'Tayyor emas' : LAB_STATUS_LABEL[status] ?? status;
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
}
export function NoteStatus({ status }: { status: string | null }) {
  if (!status) return <Badge>Qayd yo‘q</Badge>;
  return status === 'signed' ? <Badge tone="green" icon={<CheckCircle2 className={ic} />}>Tasdiqlangan</Badge> : <Badge tone="yellow" icon={<Hourglass className={ic} />}>Qoralama</Badge>;
}
