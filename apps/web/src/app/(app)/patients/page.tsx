'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Search, UserPlus, Users, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, formatPhone, fullName, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Button, Card, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Pagination, Table, Td, Th, Toolbar } from '@/components/ui';
import { PatientFormModal } from '@/components/patient-form';
import { BookingModal, BookingInit } from '@/components/booking';
import { useT } from '@/lib/i18n';

export default function PatientsPage() { return <Suspense><Patients /></Suspense>; }

/** Quiet row action: icon + verb in dark grey, blue only on hover — twenty rows must not shout. */
const rowAction = 'text-slate-700 hover:bg-slate-100 hover:text-brand-800';

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
  // a click anywhere on a row opens the card (buttons and the name link keep their own action)
  const openRow = (e: React.MouseEvent, id: string) => { if (!(e.target as HTMLElement).closest('a,button')) router.push(`/patients/${id}`); };

  return (
    <>
      <PageHeader title={me.role === 'doctor' ? t('registrar.myPatients') : t('registrar.patients')} subtitle={me.role === 'doctor' ? t('registrar.myPatientsSub') : undefined}
        actions={canEdit && <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setForm({ open: true })}>{t('registrar.addPatient')}</Button>} />
      <Card padded={false}>
        <Toolbar>
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <Input className="pl-9 pr-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('registrar.searchPlaceholder')} aria-label={t('registrar.search')} />
            {search && (
              <button type="button" onClick={() => { setSearch(''); router.replace('/patients'); }} aria-label={t('registrar.clear')} title={t('registrar.clear')}
                className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </Toolbar>
        {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? (
          <EmptyState icon={<Users />} title={dq ? t('registrar.patientNotFound') : t('registrar.noPatients')} text={dq ? t('registrar.noResults', { q: dq }) : undefined}
            action={canEdit && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setForm({ open: true })}>{t('registrar.addPatient')}</Button>} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th className="hidden md:table-cell">{t('registrar.colId')}</Th>
                <Th>{t('registrar.fullName')}</Th>
                <Th className="hidden md:table-cell">{t('registrar.birthAge')}</Th>
                {!minimal && <Th className="hidden lg:table-cell">{t('registrar.phone')}</Th>}
                <Th className="hidden 2xl:table-cell">{t('registrar.lastVisit')}</Th>
                <Th className="hidden lg:table-cell">{t('registrar.nextAppt')}</Th>
                {canEdit && <Th right><span className="sr-only">{t('registrar.actions')}</span></Th>}
              </tr></thead>
              <tbody>
                {q.data.data.map((p: any) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={(e) => openRow(e, p.id)}>
                    <Td className="hidden whitespace-nowrap tabular-nums text-slate-600 md:table-cell">{pid(p.patient_number)}</Td>
                    <Td>
                      <Link href={`/patients/${p.id}`} className="rounded font-semibold text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 lg:whitespace-nowrap">{fullName(p, true)}</Link>
                      {/* phone: the hidden columns in one short line under the name */}
                      <div className="mt-0.5 text-[0.8125rem] tabular-nums text-slate-600 md:hidden">{pid(p.patient_number)} · {ageFrom(p.birth_date, me.today)}{!minimal && p.phone ? ` · ${formatPhone(p.phone)}` : ''}</div>
                    </Td>
                    <Td className="hidden whitespace-nowrap tabular-nums md:table-cell">{fmtDate(p.birth_date)}<span className="text-slate-600"> · {ageFrom(p.birth_date, me.today)}</span></Td>
                    {!minimal && <Td className="hidden whitespace-nowrap tabular-nums lg:table-cell">{p.phone ? formatPhone(p.phone) : <span className="text-slate-600">—</span>}</Td>}
                    <Td className="hidden whitespace-nowrap tabular-nums text-slate-600 2xl:table-cell">{p.last_visit ? fmtDate(p.last_visit) : '—'}</Td>
                    <Td className="hidden whitespace-nowrap tabular-nums lg:table-cell">{p.next_appointment ? fmtDateTime(p.next_appointment) : <span className="text-slate-600">—</span>}</Td>
                    {canEdit && (
                      <Td right className="!py-1.5">
                        <Button size="sm" variant="ghost" className={rowAction} icon={<CalendarPlus className="h-4 w-4" />} aria-label={`${t('registrar.book')}: ${fullName(p)}`} title={t('registrar.book')}
                          onClick={() => setBooking({ patient: p })}><span className="hidden sm:inline">{t('registrar.bookShort')}</span></Button>
                      </Td>
                    )}
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
