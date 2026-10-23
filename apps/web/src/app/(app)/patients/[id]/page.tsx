'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, CalendarPlus, FileText, MessageSquareText, Pencil, Phone, PiggyBank, Printer, Send, ShieldAlert, Wallet, Zap } from 'lucide-react';
import { ALLERGY_LABEL, type ConsentKind, type MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, formatPhone, formatSom, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, cx, EmptyState, ErrorState, Field, KeyVal, LoadingRows, Modal, ModalCancel, Select, Table, Tabs, Td, Textarea, Th, useToast } from '@/components/ui';
import { AppointmentStatus, InvoiceStatus, LabStatus, NoteStatus } from '@/components/status';
import { PatientFormModal } from '@/components/patient-form';
import { BookingModal } from '@/components/booking';
import { WalkInModal } from '@/components/walk-in';
import { LabValues } from '@/components/lab-values';
import { ConsentBlock, ConsentModal, ConsentNotice } from '@/components/consent';
import { useT } from '@/lib/i18n';
import { canDeposit, DepositCard, DepositModal } from '@/components/deposits';

/** Quiet separator between the facts of the header line. */
const Dot = () => <span className="text-slate-400" aria-hidden="true">·</span>;

type Tab = 'overview' | 'visits' | 'notes' | 'labs' | 'invoices' | 'docs';

export default function PatientProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useSession();
  const t = useT();
  const role = me.role;
  const p = useQuery({ queryKey: ['patient', id], queryFn: () => api(`/patients/${id}`).then((r) => r.data) });
  const h = useQuery({ queryKey: ['patient', id, 'history'], queryFn: () => api(`/patients/${id}/history`).then((r) => r.data) });
  const [tab, setTab] = useState<Tab>('overview');
  const [edit, setEdit] = useState(false);
  const [book, setBook] = useState(false);
  const [walkIn, setWalkIn] = useState(false);
  const [allergy, setAllergy] = useState(false);
  const [consentKind, setConsentKind] = useState<ConsentKind | null>(null);
  const [depositing, setDepositing] = useState(false);
  const canEdit = role === 'manager' || role === 'registrar';

  if (p.isLoading) return <Card><LoadingRows rows={4} /></Card>;
  if (p.isError) return <Card><ErrorState error={p.error} onRetry={() => p.refetch()} /></Card>;
  const pt = p.data;
  const tabs: { value: Tab; label: string; count?: number }[] = [{ value: 'overview', label: t('registrar.tab.overview') }];
  if (role !== 'lab' && role !== 'cashier') tabs.push({ value: 'visits', label: t('registrar.tab.visits'), count: h.data?.visits.length });
  if (role === 'doctor') tabs.push({ value: 'notes', label: t('registrar.tab.notes'), count: h.data?.notes.length });
  if (role !== 'cashier') tabs.push({ value: 'labs', label: t('registrar.tab.labs'), count: (h.data?.labs.length ?? 0) + (h.data?.diagnostics.length ?? 0) });
  if (['manager', 'registrar', 'cashier'].includes(role)) tabs.push({ value: 'invoices', label: t('registrar.tab.invoices'), count: h.data?.invoices.length });
  if (role === 'doctor' || role === 'cashier' || role === 'lab') tabs.push({ value: 'docs', label: t('registrar.tab.docs') });

  return (
    <>
      <div className="mb-5 overflow-hidden surface">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
          <div className="flex min-w-0 flex-1 basis-[22rem] items-center gap-4">
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-700 sm:flex" aria-hidden="true">{pt.last_name?.[0]}{pt.first_name?.[0]}</div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold leading-tight text-slate-900 [overflow-wrap:anywhere]">{fullName(pt, true)}</h1>
              {/* each fact carries its own separator, so a wrapped line never ends with a dangling dot */}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] text-slate-700">
                {[
                  <span key="id" className="font-semibold tabular-nums text-slate-900">{pid(pt.patient_number)}</span>,
                  <span key="birth" className="tabular-nums">{fmtDate(pt.birth_date)} ({ageFrom(pt.birth_date, me.today)})</span>,
                  pt.sex && pt.sex !== 'unspecified' && <span key="sex">{t(`sex.${pt.sex}` as MessageKey)}</span>,
                  pt.phone !== undefined && <span key="phone" className="inline-flex items-center gap-1.5 tabular-nums"><Phone className="h-4 w-4 text-slate-500" aria-hidden="true" />{pt.phone ? formatPhone(pt.phone) : '—'}</span>,
                ].filter(Boolean).map((el, i) => <span key={i} className="inline-flex items-center gap-2 whitespace-nowrap">{i > 0 && <Dot />}{el}</span>)}
              </p>
              {(pt.balance_due > 0 || pt.deposit_balance > 0 || pt.telegram_linked || pt.source === 'telegram' || pt.notice_channel !== undefined) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {pt.balance_due > 0 && <Badge tone="red" icon={<Wallet className="h-3.5 w-3.5" />}>{t('registrar.debt', { sum: formatSom(pt.balance_due) })}</Badge>}
                  {pt.deposit_balance > 0 && <Badge tone="green" icon={<PiggyBank className="h-3.5 w-3.5" />}>{t('cash.depositBalance', { sum: formatSom(pt.deposit_balance) })}</Badge>}
                  {/* which way the patient's reminders go: Telegram, SMS (clinic's Eskiz channel), or nowhere */}
                  {pt.telegram_linked && <Badge tone="blue" icon={<Send className="h-3.5 w-3.5" />}>{t('registrar.telegramLinked')}</Badge>}
                  {pt.notice_channel === 'sms' && <Badge tone="blue" icon={<MessageSquareText className="h-3.5 w-3.5" />}>{t('registrar.noticeSms')}</Badge>}
                  {pt.notice_channel === null && !pt.telegram_linked && <Badge icon={<BellOff className="h-3.5 w-3.5" />}>{t('registrar.noticeNone')}</Badge>}
                  {pt.source === 'telegram' && <span className="text-[0.8125rem] text-slate-600">{t('registrar.telegramCard')}</span>}
                </div>
              )}
            </div>
          </div>
          {(canEdit || canDeposit(role)) && (
            <div className="flex flex-wrap gap-2">
              {canDeposit(role) && <Button icon={<PiggyBank className="h-4 w-4" />} onClick={() => setDepositing(true)}>{t('cash.depositButton')}</Button>}
              {canEdit && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>{t('registrar.edit')}</Button>}
              {canEdit && <Button icon={<Zap className="h-4 w-4" />} onClick={() => setWalkIn(true)}>{t('registrar.wi.button')}</Button>}
              {canEdit && <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setBook(true)}>{t('registrar.newAppt')}</Button>}
            </div>
          )}
        </div>
        {role === 'doctor' && (
          // a known allergy must never be missed: the same full-width red band as in the doctor workspace
          <div role={pt.allergy_state === 'known' ? 'alert' : undefined} className={cx('flex flex-wrap items-center gap-2 px-4 py-2.5 text-[0.9375rem]',
            pt.allergy_state === 'known' ? 'bg-red-700 font-bold text-white' : pt.allergy_state === 'denied' ? 'border-t border-slate-100 bg-slate-50 text-slate-800' : 'border-t border-amber-200 bg-amber-50 font-medium text-amber-900')}>
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <span>{t('registrar.allergy', { state: t(`allergy.${pt.allergy_state}` as MessageKey) })}{pt.allergy_note ? `: ${pt.allergy_note}` : ''}</span>
            <Button size="sm" className="ml-auto" onClick={() => setAllergy(true)}>{t('registrar.change')}</Button>
          </div>
        )}
        <ConsentNotice patientId={pt.id} consents={pt.consents} role={role} onRecord={() => setConsentKind('data_processing')} />
      </div>

      <Card padded={false}>
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} items={tabs} /></div>
        {h.isLoading ? <LoadingRows /> : h.isError ? <ErrorState error={h.error} onRetry={() => h.refetch()} /> : (
          <div className="p-4 sm:p-5">
            {tab === 'overview' && <Overview pt={pt} h={h.data} role={role} onConsent={setConsentKind} />}
            {tab === 'visits' && <Visits visits={h.data.visits} />}
            {tab === 'notes' && <Notes notes={h.data.notes} />}
            {tab === 'labs' && <Labs labs={h.data.labs} diagnostics={h.data.diagnostics} role={role} />}
            {tab === 'invoices' && <><Invoices invoices={h.data.invoices} /><div className="mt-6"><DepositCard patientId={pt.id} /></div></>}
            {tab === 'docs' && <Docs h={h.data} role={role} />}
          </div>
        )}
      </Card>
      <PatientFormModal open={edit} patient={pt} onClose={() => setEdit(false)} />
      <BookingModal open={book} init={{ patient: pt }} onClose={() => setBook(false)} />
      {canEdit && <WalkInModal open={walkIn} patient={pt} onClose={() => setWalkIn(false)} />}
      {role === 'doctor' && <AllergyModal open={allergy} onClose={() => setAllergy(false)} patient={pt} />}
      {depositing && <DepositModal patient={pt} onClose={() => setDepositing(false)} />}
      {pt.consents && <ConsentModal open={!!consentKind} kind={consentKind ?? 'data_processing'} patientId={pt.id} onClose={() => setConsentKind(null)} />}
    </>
  );
}

function Overview({ pt, h, role, onConsent }: { pt: any; h: any; role: string; onConsent: (kind: ConsentKind) => void }) {
  const t = useT();
  // Timeline: newest first; each row links to the visit / result / invoice it came from.
  const events: { at: string; kind: string; text: React.ReactNode; href?: string; badge: React.ReactNode }[] = [];
  h.visits.forEach((v: any) => events.push({ at: v.starts_at, kind: t('registrar.kind.visit'), text: `${v.service_name}, ${v.doctor_name}`, badge: <AppointmentStatus status={v.status} />,
    href: role === 'doctor' && v.encounter_id ? `/doctor?appointment=${v.id}` : undefined }));
  h.labs.forEach((l: any) => events.push({ at: l.verified_at ?? l.ordered_at, kind: t('registrar.kind.lab'), text: l.service_name, badge: <LabStatus status={l.status} short={role === 'registrar'} />, href: role === 'lab' ? `/lab?order=${l.id}` : undefined }));
  h.diagnostics.forEach((d: any) => events.push({ at: d.signed_at ?? d.ordered_at, kind: t('service.ultrasound'), text: d.service_name, badge: <NoteStatus status={d.report_status} />, href: `/diagnostics?order=${d.id}` }));
  h.invoices.forEach((i: any) => events.push({ at: i.created_at, kind: t('registrar.invoice'), text: `№${i.invoice_number}, ${formatSom(i.total)}`, badge: <InvoiceStatus status={i.status} />, href: `/cashier/${i.id}` }));
  events.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  // ID, birth date and phone are in the header: here only what the header does not show
  const facts = [
    pt.contact_name !== undefined && { k: t('registrar.contact'), v: pt.contact_name ? `${pt.contact_name}${pt.contact_phone ? ', ' + formatPhone(pt.contact_phone) : ''}` : '—' },
    pt.address !== undefined && { k: t('registrar.address'), v: pt.address || '—' },
    pt.note !== undefined && { k: t('registrar.note'), v: pt.note || '—' },
  ].filter(Boolean) as { k: string; v: string }[];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-[0.9375rem] font-bold text-slate-900">{t('registrar.basicInfo')}</h3>
          {facts.length ? (
            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3">
              {facts.map((f) => <div key={f.k} className="flex justify-between gap-3 py-2 text-sm"><dt className="shrink-0 text-slate-600">{f.k}</dt><dd className="min-w-0 break-words text-right font-medium text-slate-900">{f.v}</dd></div>)}
            </dl>
          ) : <p className="text-sm text-slate-600">{t('registrar.minimalInfo')}</p>}
        </section>
        {pt.consents && <ConsentBlock patientId={pt.id} patientNumber={pt.patient_number} patientName={fullName(pt)} consents={pt.consents} role={role} onRecord={onConsent} />}
      </div>
      <div className="min-w-0">
        <h3 className="mb-2 text-[0.9375rem] font-bold text-slate-900">{t('registrar.timeline')}</h3>
        {!events.length ? <EmptyState compact title={t('registrar.noEvents')} /> : (
          <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {events.slice(0, 30).map((e, i) => {
              // what happened on the first line, when and what kind on the second; the status on the right
              const body = (
                <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5', e.href && 'hover:bg-slate-50')}>
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-sm font-medium text-slate-900">{e.text}</p>
                    <p className="mt-0.5 text-[0.8125rem] tabular-nums text-slate-600">{e.kind} · {fmtDateTime(e.at)}</p>
                  </div>
                  <span className="shrink-0">{e.badge}</span>
                </div>
              );
              return <li key={i}>{e.href ? <Link href={e.href} className="block focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">{body}</Link> : body}</li>;
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function Visits({ visits }: { visits: any[] }) {
  const t = useT();
  if (!visits.length) return <EmptyState title={t('registrar.noVisits')} />;
  return (
    <Table>
      <thead><tr><Th>{t('registrar.dateTime')}</Th><Th>{t('registrar.service')}</Th><Th>{t('registrar.doctor')}</Th><Th>{t('registrar.branch')}</Th><Th>{t('registrar.status')}</Th></tr></thead>
      <tbody>{visits.map((v) => (
        <tr key={v.id}><Td className="whitespace-nowrap tabular-nums">{fmtDateTime(v.starts_at)}</Td><Td>{v.service_name}</Td><Td>{v.doctor_name}<span className="text-slate-600">, {v.specialty}</span></Td><Td>{v.branch_name}</Td><Td><AppointmentStatus status={v.status} /></Td></tr>
      ))}</tbody>
    </Table>
  );
}

function Notes({ notes }: { notes: any[] }) {
  const t = useT();
  if (!notes.length) return <EmptyState title={t('registrar.noNotes')} />;
  return (
    <div className="space-y-3">
      {notes.map((n) => (
        <div key={n.id} className="rounded-md border border-slate-200 p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
            <b>{fmtDate(n.starts_at)}</b><span className="text-slate-600">{n.doctor_name}, {n.specialty}</span><NoteStatus status={n.status} />
            {n.status === 'signed' && <Link href={`/print/note/${n.encounter_id}`} target="_blank" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><Printer className="h-3.5 w-3.5" />{t('common.print')}</Link>}
          </div>
          {n.complaints && <p className="text-sm"><span className="text-slate-600">{t('registrar.complaint')}</span> {n.complaints}</p>}
          {n.diagnosis && <p className="text-sm"><span className="text-slate-600">{t('registrar.conclusion')}</span> {n.diagnosis}</p>}
          {n.recommendations && <p className="text-sm"><span className="text-slate-600">{t('registrar.recommendation')}</span> {n.recommendations}</p>}
        </div>
      ))}
    </div>
  );
}

function Labs({ labs, diagnostics, role }: { labs: any[]; diagnostics: any[]; role: string }) {
  const t = useT();
  if (!labs.length && !diagnostics.length) return <EmptyState title={t('registrar.noLabs')} />;
  return (
    <div className="space-y-3">
      {role === 'manager' && labs.length > 0 && <p className="text-[0.8125rem] text-slate-600">{t('registrar.managerStatusOnly')}</p>}
      {labs.map((l) => (
        <div key={l.id} className="rounded-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <b>{l.service_name}</b><span className="text-slate-600">{t('registrar.orderedAt', { at: fmtDateTime(l.ordered_at) })}{l.ordered_by ? `, ${l.ordered_by}` : ''}</span>
            <span className="ml-auto"><LabStatus status={l.status} short={role === 'registrar'} /></span>
          </div>
          {l.values && l.status === 'verified' && <div className="mt-2"><LabValues values={l.values} /><p className="mt-1 text-xs text-slate-600">{t('registrar.verifiedBy', { name: l.verified_by_name, at: fmtDateTime(l.verified_at) })}</p></div>}
        </div>
      ))}
      {diagnostics.map((d) => (
        <div key={d.id} className="rounded-md border border-slate-200 p-3 text-sm">
          <div className="flex items-center gap-2"><b>{d.service_name}</b><span className="text-slate-600">{fmtDateTime(d.ordered_at)}</span><span className="ml-auto"><NoteStatus status={d.report_status} /></span></div>
          {d.report_status === 'signed' && <p className="mt-1"><span className="text-slate-600">{t('registrar.conclusion')}</span> {d.conclusion}</p>}
        </div>
      ))}
    </div>
  );
}

function Invoices({ invoices }: { invoices: any[] }) {
  const t = useT();
  if (!invoices.length) return <EmptyState title={t('registrar.noInvoices')} />;
  return (
    <Table>
      <thead><tr><Th>{t('registrar.invoice')}</Th><Th>{t('registrar.status')}</Th><Th>{t('registrar.date')}</Th><Th>{t('registrar.services')}</Th><Th right>{t('registrar.total')}</Th><Th right className="hidden 2xl:table-cell">{t('registrar.paid')}</Th><Th right>{t('registrar.balance')}</Th></tr></thead>
      <tbody>{invoices.map((i) => (
        <tr key={i.id} className="hover:bg-slate-50">
          <Td className="whitespace-nowrap"><Link href={`/cashier/${i.id}`} className="rounded font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">№{i.invoice_number}</Link></Td>
          <Td><InvoiceStatus status={i.status} /></Td>
          <Td className="whitespace-nowrap">{fmtDate(i.created_at)}</Td><Td className="min-w-[12rem]">{i.services}</Td>
          <Td right>{formatSom(i.total)}</Td><Td right className="hidden 2xl:table-cell">{formatSom(i.paid_amount)}</Td><Td right className={i.status !== 'void' && i.total - i.paid_amount > 0 ? 'font-medium text-red-700' : ''}>{i.status === 'void' ? '—' : formatSom(i.total - i.paid_amount)}</Td>
        </tr>
      ))}</tbody>
    </Table>
  );
}

function Docs({ h, role }: { h: any; role: string }) {
  const t = useT();
  const docs: { title: string; href: string; date: string }[] = [];
  if (role === 'doctor') h.notes.filter((n: any) => n.status === 'signed').forEach((n: any) => docs.push({ title: t('registrar.docNote', { specialty: n.specialty }), href: `/print/note/${n.encounter_id}`, date: n.signed_at }));
  if (role === 'doctor' || role === 'lab') h.labs.filter((l: any) => l.status === 'verified').forEach((l: any) => docs.push({ title: t('registrar.docLab', { service: l.service_name }), href: `/print/lab/${l.id}`, date: l.verified_at }));
  if (role === 'doctor') h.diagnostics.filter((d: any) => d.report_status === 'signed').forEach((d: any) => docs.push({ title: t('registrar.docUzi', { service: d.service_name }), href: `/print/uzi/${d.id}`, date: d.signed_at }));
  if (role === 'cashier') h.invoices.forEach((i: any) => docs.push({ title: t('registrar.docInvoice', { n: i.invoice_number }), href: `/cashier/${i.id}`, date: i.created_at }));
  if (!docs.length) return <EmptyState title={t('registrar.noDocs')} text={t('registrar.noDocsText')} />;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {docs.sort((a, b) => +new Date(b.date) - +new Date(a.date)).map((d) => (
        <li key={d.href} className="flex items-center gap-3 px-3 py-2 text-sm">
          <FileText className="h-4 w-4 text-slate-400" /><span className="flex-1">{d.title}</span><span className="text-slate-600">{fmtDate(d.date)}</span>
          <Link href={d.href} target={d.href.startsWith('/print') ? '_blank' : undefined} className="font-medium text-brand-700 hover:underline">{t('registrar.open')}</Link>
        </li>
      ))}
    </ul>
  );
}

function AllergyModal({ open, onClose, patient }: { open: boolean; onClose: () => void; patient: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [state, setState] = useState(patient.allergy_state);
  const [note, setNote] = useState(patient.allergy_note ?? '');
  const m = useMutation({
    mutationFn: () => api(`/patients/${patient.id}`, { method: 'PATCH', body: { allergy_state: state, allergy_note: state === 'known' ? note : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient'] }); qc.invalidateQueries({ queryKey: ['encounter'] }); toast.success(t('registrar.allergySaved')); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} dirty={!m.isPending && (state !== patient.allergy_state || note !== (patient.allergy_note ?? ''))} title={t('registrar.allergyTitle')} footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={state === 'known' && !note.trim()} onClick={() => m.mutate()}>{t('common.save')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('registrar.status')}>{(id) => <Select id={id} value={state} onChange={(e) => setState(e.target.value)}>{Object.keys(ALLERGY_LABEL).map((k) => <option key={k} value={k}>{t(`allergy.${k}` as MessageKey)}</option>)}</Select>}</Field>
        {state === 'known' && <Field label={t('registrar.allergen')} required>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>}
        <Alert tone="blue">{t('registrar.allergyHint')}</Alert>
      </div>
    </Modal>
  );
}
