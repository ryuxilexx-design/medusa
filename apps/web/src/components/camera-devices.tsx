'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleSlash, Copy, FlaskConical, KeyRound, Pencil, RefreshCw, ScanFace, Send } from 'lucide-react';
import { CAMERA_PURPOSES, type CameraPurpose, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Select, Table, Td, Th, useToast } from './ui';

export type Camera = {
  id: string; branch_id: string; branch_name: string; name: string; location: string | null; model: string | null;
  purposes: CameraPurpose[]; security_mode: 'always' | 'after_hours'; token_hint: string; status: 'active' | 'disabled';
  last_event_at: string | null; last_seen_at: string | null; created_at: string; events_24h: number;
};
export type CamerasList = { data: Camera[]; meta: { simulator_available: boolean } };

/** Menu names in the camera's own (English) web interface: data, shown exactly as the camera shows them. */
const HIK = {
  listening: 'Configuration → Network → Advanced Settings → HTTP Listening (Alarm Server)',
  event: 'Configuration → Event',
  notify: '«Notify Surveillance Center»',
};
const DAY_MS = 24 * 3600_000;
const ic = 'h-4 w-4';

// ---------- face codes ----------

type StaffCode = { membership_id: string; full_name: string; role: string; specialty: string | null; face_code_id: string | null; code: string | null; created_at: string | null; last_seen_at: string | null };

/** Staff and their camera codes; the face itself is enrolled on the camera under this code. */
export function FaceCodes() {
  const t = useT();
  const q = useQuery({ queryKey: ['cameras', 'face-codes'], queryFn: () => api<{ data: StaffCode[]; meta: { patient_codes: number } }>('/cameras/face-codes') });
  const [giving, setGiving] = useState<StaffCode | null>(null);
  const [revoking, setRevoking] = useState<StaffCode | null>(null);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <Card className="xl:col-span-2" padded={false} title={t('cam.codes.staffTitle')}
        actions={q.data && <span title={t('cam.codes.patientsHint')}><Badge tone="gray">{t('cam.codes.patients', { n: q.data.meta.patient_codes })}</Badge></span>}>
        {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('cam.codes.empty')} /> : (
          <Table>
            <thead><tr><Th>{t('cam.col.staff')}</Th><Th>{t('cam.col.code')}</Th><Th className="hidden md:table-cell">{t('cam.col.lastSeen')}</Th><Th right><span className="sr-only">{t('cam.col.actions')}</span></Th></tr></thead>
            <tbody>{q.data.data.map((s) => (
              <tr key={s.membership_id}>
                <Td className="min-w-[11rem]"><div className="font-semibold text-slate-900">{s.full_name}</div><div className="text-[0.8125rem] text-slate-600">{t(`role.${s.role}` as MessageKey)}{s.specialty ? `, ${s.specialty}` : ''}</div></Td>
                <Td className="whitespace-nowrap">{s.code ? <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[0.9375rem] font-bold text-slate-900">{s.code}</span> : <span className="text-slate-600">{t('cam.codes.none')}</span>}</Td>
                <Td className="hidden whitespace-nowrap tabular-nums text-slate-700 md:table-cell">{s.code ? (s.last_seen_at ? fmtDateTime(s.last_seen_at) : t('cam.codes.never')) : '—'}</Td>
                <Td right className="whitespace-nowrap !py-1.5">
                  {s.code
                    ? <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" icon={<CircleSlash className={ic} />} aria-label={t('cam.codes.revoke')} title={t('cam.codes.revoke')} onClick={() => setRevoking(s)}><span className="hidden sm:inline">{t('cam.codes.revoke')}</span></Button>
                    : <Button size="sm" icon={<KeyRound className={ic} />} aria-label={t('cam.codes.give')} title={t('cam.codes.give')} onClick={() => setGiving(s)}><span className="hidden sm:inline">{t('cam.codes.give')}</span></Button>}
                </Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <Card className="self-start" title={<span className="flex items-center gap-2"><ScanFace className="h-5 w-5 text-brand-600" aria-hidden="true" />{t('cam.codes.howTitle')}</span>}>
        <ol className="space-y-2 text-[0.9375rem] text-slate-800">
          {(['cam.codes.step1', 'cam.codes.step2', 'cam.codes.step3'] as const).map((k, i) => (
            <li key={k} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-800">{i + 1}</span><span className="pt-0.5">{t(k, { code: 'S-12', idNo: 'ID No.', name: 'Name' })}</span></li>
          ))}
        </ol>
      </Card>
      <GiveCodeModal row={giving} onClose={() => setGiving(null)} />
      <RevokeCodeModal row={revoking} onClose={() => setRevoking(null)} />
    </div>
  );
}

function GiveCodeModal({ row, onClose }: { row: StaffCode | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (row) { setConfirmed(false); setError(null); } }, [row]);
  const m = useMutation({
    mutationFn: () => api<{ data: { code: string; already?: boolean } }>('/cameras/face-codes', { method: 'POST', body: { membership_id: row!.membership_id, consent_confirmed: true } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['cameras'] }); toast.success(t(r.data.already ? 'cam.codes.already' : 'cam.codes.given', { code: r.data.code })); onClose(); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const submit = () => { setError(null); if (!confirmed) { setError(t('cam.codes.consentRequired')); return; } m.mutate(); };
  return (
    <Modal open={!!row} onClose={onClose} title={row ? t('cam.codes.giveTitle', { name: row.full_name }) : ''} dirty={confirmed && !m.isSuccess}
      footer={<><ModalCancel /><Button variant="primary" icon={<KeyRound className={ic} />} loading={m.isPending} onClick={submit}>{t('cam.codes.give')}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[0.9375rem] text-slate-900">
          <input type="checkbox" data-autofocus className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={confirmed} aria-invalid={!!error && !confirmed || undefined}
            onChange={(e) => { setConfirmed(e.target.checked); setError(null); }} />
          <span>{t('cam.codes.consent')} <span className="text-red-700" aria-hidden="true">*</span></span>
        </label>
        {error && <Alert tone="red">{error}</Alert>}
      </form>
    </Modal>
  );
}

function RevokeCodeModal({ row, onClose }: { row: StaffCode | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api(`/cameras/face-codes/${row!.face_code_id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cameras'] }); toast.success(t('cam.codes.revoked')); onClose(); },
  });
  useEffect(() => { if (row) m.reset(); }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={!!row} onClose={onClose} title={t('cam.codes.revokeTitle')}
      footer={<><ModalCancel /><Button variant="danger" icon={<CircleSlash className={ic} />} loading={m.isPending} onClick={() => m.mutate()}>{t('cam.codes.revoke')}</Button></>}>
      <div className="space-y-3">
        <p className="text-[0.9375rem] text-slate-900">{row && t('cam.codes.revokeText', { name: row.full_name, code: row.code })}</p>
        {m.isError && <Alert tone="red">{(m.error as Error).message}</Alert>}
      </div>
    </Modal>
  );
}

// ---------- devices ----------

/** Word + icon + colour for a camera: working, never heard from, silent for a day, or switched off. */
function CameraStatus({ c }: { c: Camera }) {
  const t = useT();
  const { demoNow } = useSession();
  if (c.status === 'disabled') return <Badge tone="gray" icon={<CircleSlash className={ic} />}>{t('cam.dev.disabled')}</Badge>;
  // contact = the camera's own pushes and heartbeats (last_seen_at); demo cameras only have simulated events
  if (!c.last_seen_at && !c.last_event_at) return <Badge tone="yellow" icon={<AlertTriangle className={ic} />}>{t('cam.dev.waiting')}</Badge>;
  if (c.last_seen_at && +demoNow() - +new Date(c.last_seen_at) > DAY_MS) return <Badge tone="yellow" icon={<AlertTriangle className={ic} />}>{t('cam.dev.silent')}</Badge>;
  return <Badge tone="green" icon={<CheckCircle2 className={ic} />}>{t('cam.dev.ok')}</Badge>;
}

export function PurposeBadges({ purposes }: { purposes: CameraPurpose[] }) {
  const t = useT();
  return <div className="flex flex-wrap gap-1">{CAMERA_PURPOSES.filter((p) => purposes.includes(p)).map((p) => <Badge key={p} tone="gray" className="!text-2xs !px-2">{t(`cam.purpose.${p}`)}</Badge>)}</div>;
}

export function Devices({ q, onEdit, onAdd }: { q: { data?: CamerasList; isError: boolean; error: unknown; refetch: () => void }; onEdit: (c: Camera) => void; onAdd: () => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const [testing, setTesting] = useState<Camera | null>(null);
  const showBranch = !branchId && me.branches.length > 1;
  const rows = q.data?.data.filter((c) => !branchId || c.branch_id === branchId) ?? [];
  return (
    <Card padded={false}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <LoadingRows /> : !rows.length ? (
        <EmptyState compact title={t('cam.dev.empty')} action={<Button onClick={onAdd}>{t('cam.add')}</Button>} />
      ) : (
        <Table>
          <thead><tr>
            <Th>{t('cam.col.camera')}</Th><Th className="hidden md:table-cell">{t('cam.col.purposes')}</Th>
            <Th className="hidden sm:table-cell">{t('cam.col.status')}</Th><Th className="hidden sm:table-cell">{t('cam.col.lastEvent')}</Th><Th right><span className="sr-only">{t('cam.col.actions')}</span></Th>
          </tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id} className={c.status === 'disabled' ? 'text-slate-600' : ''}>
              <Td className="min-w-[10rem]"><div className="font-semibold text-slate-900">{c.name}</div><div className="text-[0.8125rem] text-slate-600">{[showBranch ? c.branch_name : null, c.location, c.model].filter(Boolean).join(' · ') || '—'}</div><div className="mt-1 sm:hidden"><CameraStatus c={c} /></div></Td>
              <Td className="hidden md:table-cell"><PurposeBadges purposes={c.purposes} /></Td>
              <Td className="hidden whitespace-nowrap sm:table-cell"><CameraStatus c={c} /></Td>
              <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell"><div className="text-slate-900">{c.last_event_at ? fmtDateTime(c.last_event_at) : t('cam.dev.never')}</div><div className="text-[0.8125rem] text-slate-600">{t('cam.dev.events24', { n: c.events_24h })}</div></Td>
              <Td right className="whitespace-nowrap !py-1.5">
                <div className="flex flex-wrap justify-end gap-1">
                  {q.data!.meta.simulator_available && c.status === 'active' && <Button size="sm" variant="ghost" className="text-slate-700 hover:bg-slate-100 hover:text-brand-800" icon={<FlaskConical className={ic} />} aria-label={t('cam.dev.test')} title={t('cam.dev.test')} onClick={() => setTesting(c)}><span className="hidden sm:inline">{t('cam.dev.test')}</span></Button>}
                  <Button size="sm" variant="ghost" className="text-slate-700 hover:bg-slate-100 hover:text-brand-800" icon={<Pencil className={ic} />} aria-label={t('cam.dev.edit')} title={t('cam.dev.edit')} onClick={() => onEdit(c)}><span className="hidden sm:inline">{t('cam.dev.edit')}</span></Button>
                </div>
              </Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      <SimulateModal camera={testing} onClose={() => setTesting(null)} />
    </Card>
  );
}

type Form = { branch_id: string; name: string; location: string; model: string; purposes: CameraPurpose[]; security_mode: 'always' | 'after_hours'; status: 'active' | 'disabled' };

/** Add a camera (the push address is then shown once) or change one; «Manzilni yangilash» issues a new address. */
export function CameraFormModal({ open, camera, onClose, onPushPath }: { open: boolean; camera: Camera | null; onClose: () => void; onPushPath: (path: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me, branchId } = useSession();
  const initial = useMemo<Form>(() => camera
    ? { branch_id: camera.branch_id, name: camera.name, location: camera.location ?? '', model: camera.model ?? '', purposes: camera.purposes, security_mode: camera.security_mode, status: camera.status }
    : { branch_id: branchId || me.branches[0]?.id || '', name: '', location: '', model: '', purposes: ['attendance', 'patient_arrival'], security_mode: 'after_hours', status: 'active' }, [camera, branchId, me.branches]);
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  useEffect(() => { if (open) { setF(initial); setErrors({}); setFormError(null); setRotating(false); } }, [open, initial]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const fail = (e: unknown) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); setFormError(e instanceof Error ? e.message : String(e)); };
  const save = useMutation({
    mutationFn: () => {
      const body = { branch_id: f.branch_id, name: f.name, location: f.location, model: f.model, purposes: f.purposes, security_mode: f.security_mode };
      return camera
        ? api<{ data: { id: string } }>(`/cameras/${camera.id}`, { method: 'PATCH', body: { ...body, status: f.status } })
        : api<{ data: { id: string; push_path: string } }>('/cameras', { method: 'POST', body });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cameras'] });
      onClose();
      const path = (r.data as { push_path?: string }).push_path;
      if (path) onPushPath(path); else toast.success(t('cam.form.saved'));
    },
    onError: fail,
  });
  const rotate = useMutation({
    mutationFn: () => api<{ data: { push_path: string } }>(`/cameras/${camera!.id}/token`, { method: 'POST' }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['cameras'] }); onClose(); onPushPath(r.data.push_path); },
    onError: (e) => { setRotating(false); fail(e); },
  });
  const submit = () => {
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = t('api.v.cameraName');
    if (!f.purposes.length) errs.purposes = t('api.v.cameraPurpose');
    if (!f.branch_id) errs.branch_id = t('api.v.branch');
    if (Object.keys(errs).length) { setErrors(errs); return; }
    save.mutate();
  };
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const togglePurpose = (p: CameraPurpose) => set('purposes', f.purposes.includes(p) ? f.purposes.filter((x) => x !== p) : [...f.purposes, p]);
  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !save.isSuccess} title={camera ? t('cam.form.editTitle') : t('cam.add')}
      footer={rotating ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 basis-[14rem] text-sm text-amber-900">{t('cam.form.rotateText')}</p>
          <div className="flex gap-2"><Button onClick={() => setRotating(false)}>{t('common.cancel')}</Button><Button variant="danger" icon={<RefreshCw className={ic} />} loading={rotate.isPending} onClick={() => rotate.mutate()}>{t('cam.form.rotate')}</Button></div>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-2">
          {camera && <Button icon={<RefreshCw className={ic} />} onClick={() => setRotating(true)}>{t('cam.form.rotate')}</Button>}
          <div className="ml-auto flex gap-2"><ModalCancel /><Button variant="primary" loading={save.isPending} onClick={submit}>{t('common.save')}</Button></div>
        </div>
      )}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {formError && <Alert tone="red">{formError}</Alert>}
        {me.branches.length > 1 && (
          <Field label={t('cam.form.branch')} required error={errors.branch_id}>{(id) => (
            <Select id={id} value={f.branch_id} invalid={!!errors.branch_id} onChange={(e) => set('branch_id', e.target.value)}>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          )}</Field>
        )}
        <Field label={t('cam.form.name')} required error={errors.name}>{(id) => <Input id={id} maxLength={80} value={f.name} invalid={!!errors.name} placeholder={t('cam.form.namePh')} onChange={(e) => set('name', e.target.value)} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('cam.form.location')} error={errors.location}>{(id) => <Input id={id} maxLength={120} value={f.location} placeholder={t('cam.form.locationPh')} onChange={(e) => set('location', e.target.value)} />}</Field>
          <Field label={t('cam.form.model')} error={errors.model}>{(id) => <Input id={id} maxLength={60} value={f.model} placeholder="DS-2CD7146G0-IZS" onChange={(e) => set('model', e.target.value)} />}</Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-slate-800">{t('cam.form.purposes')} <span className="text-red-700" aria-hidden="true">*</span></legend>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {CAMERA_PURPOSES.map((p) => (
              <label key={p} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] text-slate-900">
                <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.purposes.includes(p)} onChange={() => togglePurpose(p)} aria-invalid={!!errors.purposes || undefined} />{t(`cam.purpose.${p}`)}
              </label>
            ))}
          </div>
          {errors.purposes && <p className="mt-1 text-sm font-medium text-red-700" role="alert">{errors.purposes}</p>}
        </fieldset>
        {f.purposes.includes('security') && (
          <Field label={t('cam.form.securityMode')} error={errors.security_mode}>{(id) => (
            <Select id={id} value={f.security_mode} onChange={(e) => set('security_mode', e.target.value as Form['security_mode'])}>
              <option value="after_hours">{t('cam.form.afterHours')}</option><option value="always">{t('cam.form.always')}</option>
            </Select>
          )}</Field>
        )}
        {camera && (
          <Field label={t('cam.form.status')}>{(id) => (
            <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value as Form['status'])}>
              <option value="active">{t('cam.form.active')}</option><option value="disabled">{t('cam.dev.disabled')}</option>
            </Select>
          )}</Field>
        )}
      </form>
    </Modal>
  );
}

/** The camera's secret push address, shown exactly once (only its hash is stored), with the camera-side setup. */
export function PushAddressModal({ path, onClose }: { path: string | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const { me } = useSession();
  if (!path || typeof window === 'undefined') return null;
  const loc = window.location;
  const https = loc.protocol === 'https:';
  const url = loc.origin + path;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success(t('cam.push.copied')); } catch { toast.error(t('cam.push.copyFailed')); }
  };
  const steps = [
    t('cam.push.step1', { menu: HIK.listening }),
    t('cam.push.step2', { host: loc.hostname, port: loc.port || (https ? 443 : 80), path, protocol: https ? 'HTTPS' : 'HTTP' }),
    t('cam.push.step3', { menu: HIK.event, notify: HIK.notify }),
    t('cam.push.step4'),
  ];
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={t('cam.push.title')}
      footer={<Button variant="primary" onClick={onClose}>{t('cam.push.done')}</Button>}>
      <div className="space-y-4">
        <Alert tone="yellow">{t('cam.push.once')}</Alert>
        <Field label={t('cam.push.url')}>{(id) => (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id={id} readOnly value={url} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} data-testid="push-url" />
            <Button data-autofocus icon={<Copy className={ic} />} onClick={() => void copy()}>{t('cam.push.copy')}</Button>
          </div>
        )}</Field>
        {/* demo: a phone can stand in for the camera (the token travels in the #fragment, never in a server log) */}
        {me.demo && (
          <Alert tone="blue" title={t('cam.phone.open')}>
            {t('cam.phone.openHint')}{' '}
            <a className="break-all font-semibold underline" href={`/phone-camera#${path.split('/').pop()}`} target="_blank" rel="noopener">{`${loc.origin}/phone-camera#${path.split('/').pop()}`}</a>
          </Alert>
        )}
        <section aria-labelledby="push-setup-h">
          <h3 id="push-setup-h" className="mb-2 text-[0.9375rem] font-bold text-slate-900">{t('cam.push.setup')}</h3>
          <ol className="space-y-2 text-[0.9375rem] text-slate-800">
            {steps.map((s, i) => <li key={i} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-800">{i + 1}</span><span className="min-w-0 break-words pt-0.5">{s}</span></li>)}
          </ol>
        </section>
      </div>
    </Modal>
  );
}

type SimKind = 'face_match' | 'people_count' | 'intrusion' | 'line_crossing' | 'region_entrance' | 'region_exit' | 'tamper';
const SECURITY_KINDS: SimKind[] = ['intrusion', 'line_crossing', 'region_entrance', 'region_exit', 'tamper'];
const IGNORED = ['purpose', 'no_code', 'low_similarity', 'unknown_code', 'no_consent', 'duplicate'];

/** Demo only: a synthetic event for this camera, through the same server rules as a real one. */
function SimulateModal({ camera, onClose }: { camera: Camera | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const kinds = useMemo<SimKind[]>(() => {
    if (!camera) return [];
    const k: SimKind[] = [];
    if (camera.purposes.includes('attendance') || camera.purposes.includes('patient_arrival')) k.push('face_match');
    if (camera.purposes.includes('counting')) k.push('people_count');
    if (camera.purposes.includes('security')) k.push(...SECURITY_KINDS);
    return k;
  }, [camera]);
  const [kind, setKind] = useState<SimKind>('face_match');
  const [code, setCode] = useState('');
  const [enter, setEnter] = useState('1');
  const [exit, setExit] = useState('0');
  useEffect(() => { if (camera) { setKind(kinds[0] ?? 'face_match'); setCode(''); setEnter('1'); setExit('0'); } }, [camera, kinds]);
  const m = useMutation({
    mutationFn: () => api<{ data: { stored: boolean; ignored?: string; suggestion?: boolean } }>(`/cameras/${camera!.id}/simulate`, {
      method: 'POST',
      body: { kind, ...(kind === 'face_match' ? { code: code.trim().toUpperCase() } : {}), ...(kind === 'people_count' ? { enter: Number(enter) || 0, exit: Number(exit) || 0 } : {}) },
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cameras'] });
      if (r.data.stored) toast.success(t(r.data.suggestion ? 'cam.sim.suggestion' : 'cam.sim.stored'));
      else toast.info(t('cam.sim.ignored', { reason: IGNORED.includes(r.data.ignored ?? '') ? t(`cam.ign.${r.data.ignored}` as MessageKey) : r.data.ignored }));
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={!!camera} onClose={onClose} title={camera ? t('cam.sim.title', { name: camera.name }) : ''}
      footer={<><Button onClick={onClose}>{t('common.close')}</Button><Button variant="primary" icon={<Send className={ic} />} loading={m.isPending} onClick={() => m.mutate()}>{t('cam.sim.send')}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
        <Field label={t('cam.sim.kind')}>{(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as SimKind)}>{kinds.map((k) => <option key={k} value={k}>{t(`cam.kind.${k}`)}</option>)}</Select>
        )}</Field>
        {kind === 'face_match' && <Field label={t('cam.sim.code')} hint={t('cam.sim.codeHint', { staff: 'S-1', patient: 'P-1001' })}>{(id) => <Input id={id} maxLength={12} className="font-mono" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>}
        {kind === 'people_count' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('cam.sim.enter')}>{(id) => <Input id={id} type="number" min={0} max={500} inputMode="numeric" value={enter} onChange={(e) => setEnter(e.target.value)} />}</Field>
            <Field label={t('cam.sim.exit')}>{(id) => <Input id={id} type="number" min={0} max={500} inputMode="numeric" value={exit} onChange={(e) => setExit(e.target.value)} />}</Field>
          </div>
        )}
      </form>
    </Modal>
  );
}

