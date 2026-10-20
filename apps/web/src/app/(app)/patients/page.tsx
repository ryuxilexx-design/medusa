'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Pencil, Search, UserPlus, Users } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, formatPhone, fullName, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Button, Card, EmptyState, LinkButton, ErrorState, Input, LoadingRows, PageHeader, Pagination, Table, Td, Th } from '@/components/ui';
import { PatientFormModal } from '@/components/patient-form';
import { BookingModal, BookingInit } from '@/components/booking';
import { useT } from '@/lib/i18n';

export default function PatientsPage() { return <Suspense><Patients /></Suspense>; }

function Patients() {
  const { me } = useSession();
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [page, setPage] = useState(1);
  const dq = useDebounced(search.trim(), 300);
  useEffect(() => { setSearch(sp.get('search') ?? ''); }, [sp]);
  useEffect(() => setPage(1), [dq]);
  const canEdit = me.role === 'manager' || me.role === 'registrar';
  const [form, setForm] = useState<{ open: boolean; patient?: any }>({ open: false });
  const [booking, setBooking] = useState<BookingInit | null>(null);
  const q = useQuery({ queryKey: ['patients', dq, page], queryFn: () => api(`/patients${qs({ search: dq, page, page_size: 20 })}`) , placeholderData: (p) => p });
  const minimal = me.role === 'cashier' || me.role === 'lab';

  return (
    <>
      <PageHeader title={me.role === 'doctor' ? t('registrar.myPatients') : t('registrar.patients')} subtitle={me.role === 'doctor' ? t('registrar.myPatientsSub') : t('registrar.patientsSub')}
        actions={canEdit && <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setForm({ open: true })}>{t('registrar.addPatient')}</Button>} />
      <Card padded={false}>
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('registrar.searchPlaceholder')} aria-label={t('registrar.search')} />
          </div>
          {search && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); router.replace('/patients'); }}>{t('registrar.clear')}</Button>}
        </div>
        {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? (
          <EmptyState icon={<Users className="h-8 w-8" />} title={dq ? t('registrar.patientNotFound') : t('registrar.noPatients')} text={dq ? t('registrar.noResults', { q: dq }) : undefined}
            action={canEdit && <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setForm({ open: true })}>{t('registrar.addPatient')}</Button>} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>{t('registrar.colId')}</Th><Th>{t('registrar.fullName')}</Th><Th className="!whitespace-normal">{t('registrar.birthAge')}</Th>{!minimal && <Th>{t('registrar.phone')}</Th>}<Th className="hidden 2xl:table-cell">{t('registrar.lastVisit')}</Th><Th className="!whitespace-normal">{t('registrar.nextAppt')}</Th><Th right>{t('registrar.actions')}</Th></tr></thead>
              <tbody>
                {q.data.data.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td className="whitespace-nowrap tabular-nums text-slate-600">{pid(p.patient_number)}</Td>
                    <Td className="min-w-[10rem]"><Link href={`/patients/${p.id}`} className="rounded font-semibold text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{fullName(p, true)}</Link></Td>
                    <Td className="whitespace-nowrap">{fmtDate(p.birth_date)}<span className="text-slate-600">, {ageFrom(p.birth_date, me.today)}</span></Td>
                    {!minimal && <Td className="whitespace-nowrap tabular-nums">{formatPhone(p.phone)}</Td>}
                    <Td className="hidden whitespace-nowrap text-slate-600 2xl:table-cell">{p.last_visit ? fmtDate(p.last_visit) : '—'}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{p.next_appointment ? fmtDateTime(p.next_appointment) : '—'}</Td>
                    <Td right>
                      <div className="flex items-center justify-end gap-1">
                        {canEdit ? <>
                          <Button size="sm" variant="ghost" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setBooking({ patient: p })}>{t('registrar.book')}</Button>
                          <Button size="sm" variant="ghost" aria-label={`${t('registrar.editBasic')}: ${fullName(p)}`} onClick={() => setForm({ open: true, patient: p })}><Pencil className="h-4 w-4" /></Button>
                        </> : <LinkButton size="sm" variant="ghost" href={`/patients/${p.id}`}>{t('registrar.profile')}</LinkButton>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <PatientFormModal open={form.open} patient={form.patient} onClose={() => setForm({ open: false })}
        onSaved={async (id, created) => {
          if (created) { const p = await api(`/patients/${id}`).then((r) => r.data); setSearch(''); setBooking({ patient: p }); }
        }} />
      <BookingModal open={!!booking} init={booking ?? undefined} onClose={() => setBooking(null)} />
    </>
  );
}
