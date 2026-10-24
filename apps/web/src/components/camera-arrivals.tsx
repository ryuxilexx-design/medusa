'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cctv, UserCheck, X } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { fmtTime, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, TextLink, useToast } from './ui';

type Arrival = {
  id: string; seen_at: string; camera_name: string; appointment_id: string; starts_at: string; version: number;
  patient_id: string; patient_number: number; last_name: string; first_name: string; middle_name: string | null; doctor_name: string; service_name: string;
};

/**
 * «Kamera tanidi»: today's patients the reception camera recognised, for the registrar to confirm with one click.
 * Nothing changes on the appointment until a person presses «Keldi deb belgilash». Hidden when there is nothing.
 */
export function CameraArrivals() {
  const { me, branchId } = useSession();
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = me.role === 'manager' || me.role === 'registrar';
  const q = useQuery({
    queryKey: ['cameras', 'arrivals', branchId],
    queryFn: () => api<{ data: Arrival[] }>(`/cameras/arrivals${qs({ branch_id: branchId })}`).then((r) => r.data),
    enabled: allowed, refetchInterval: 30_000, retry: false,
  });
  const refresh = () => ['cameras', 'appointments', 'queue', 'patient', 'patients', 'dashboard', 'invoices'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const accept = useMutation({
    mutationFn: (id: string) => api<{ data: { queue_number: number; already?: boolean } }>(`/cameras/arrivals/${id}/accept`, { method: 'POST' }),
    onSuccess: (r) => { refresh(); toast.success(t(r.data.already ? 'registrar.ap.alreadyQueued' : 'registrar.ap.queued', { n: r.data.queue_number })); },
    onError: (e) => { toast.error(e); if (e instanceof ApiError && e.status === 409) refresh(); },
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/cameras/arrivals/${id}/dismiss`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cameras', 'arrivals'] }); toast.info(t('cam.arr.dismissed')); },
    onError: (e) => { toast.error(e); if (e instanceof ApiError && e.status === 409) refresh(); },
  });
  if (!allowed || !q.data?.length) return null;
  const busy = (id: string) => (accept.isPending && accept.variables === id) || (dismiss.isPending && dismiss.variables === id);
  return (
    <section aria-labelledby="cam-arrivals-h" className="mb-5 rounded-xl border border-sky-200 bg-white" data-testid="camera-arrivals">
      <h2 id="cam-arrivals-h" className="flex items-center gap-2 border-b border-sky-100 px-5 py-3 text-base font-bold text-slate-900">
        <Cctv className="h-5 w-5 text-brand-600" aria-hidden="true" />{t('cam.arr.title')}<Badge tone="blue">{q.data.length}</Badge>
      </h2>
      <ul className="divide-y divide-slate-100">
        {q.data.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
            <div className="min-w-0 flex-1 basis-[16rem] leading-snug">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <TextLink tone="ink" href={`/patients/${a.patient_id}`} className="[overflow-wrap:anywhere]">{fullName(a)}</TextLink>
                <span className="text-small tabular-nums text-slate-600">{pid(a.patient_number)}</span>
              </div>
              <div className="text-small text-slate-600">
                {t('cam.arr.booked', { time: fmtTime(a.starts_at), doctor: a.doctor_name })} · <span className="whitespace-nowrap font-semibold text-slate-800">{t('cam.arr.seen', { time: fmtTime(a.seen_at) })}</span>
              </div>
            </div>
            {/* the primary action first on a phone, on the right on a wide screen */}
            <div className="flex flex-wrap gap-2 sm:flex-row-reverse">
              <Button size="sm" variant="primary" icon={<UserCheck className="h-4 w-4" />} disabled={busy(a.id)}
                loading={accept.isPending && accept.variables === a.id} onClick={() => accept.mutate(a.id)}>{t('cam.arr.accept')}</Button>
              <Button size="sm" variant="ghost" className="text-slate-700 hover:bg-slate-100" icon={<X className="h-4 w-4" />} disabled={busy(a.id)}
                loading={dismiss.isPending && dismiss.variables === a.id} onClick={() => dismiss.mutate(a.id)}>{t('cam.arr.dismiss')}</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
