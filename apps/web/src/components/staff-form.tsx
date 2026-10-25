'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Power } from 'lucide-react';
import { normalizeLogin, type MessageKey, type Role } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Button, Checkbox, cx, Field, Input, Modal, ModalCancel, Select, useToast } from '@/components/ui';

export type StaffRow = {
  membership_id: string; full_name: string; login: string | null; role: Role; title: string | null; status: 'active' | 'inactive';
  branch_ids: string[]; branch_names: string[] | null; demo_card: boolean; is_self: boolean; has_password: boolean; must_change_password: boolean;
  last_login_at: string | null; locked: boolean | null; doctor_id: string | null; has_schedule: boolean; specialty: string | null; default_share_percent: number | null; service_ids: string[];
};
type Issued = { name: string; login: string; temp_password: string };
type Form = { full_name: string; role: Role; title: string; login: string; branch_ids: string[]; specialty: string; share_percent: string; service_ids: string[] };

const ROLES: Role[] = ['registrar', 'doctor', 'cashier', 'lab', 'storekeeper', 'guard', 'manager'];
const loginView = (l: string | null) => (l ? (l.startsWith('+998') ? formatPhone(l) : l) : '');

/** Create a staff account or edit one. Password reset and (de)activation live here too, never for one's own account. */
export function StaffFormModal({ open, staff, onClose, onIssued }: { open: boolean; staff: StaffRow | null; onClose: () => void; onIssued: (i: Issued) => void }) {
  const { me, branchId } = useSession();
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = !staff;
  // Start with the branch picked in the header (or the only one); the manager can tick more.
  const empty: Form = { full_name: '', role: 'registrar', title: '', login: '', branch_ids: branchId ? [branchId] : me.branches.length === 1 ? [me.branches[0].id] : [], specialty: '', share_percent: '30', service_ids: [] };
  const [v, setV] = useState<Form>(empty);
  const [initial, setInitial] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'reset' | 'status' | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  // the confirmation replaces the footer actions: move focus to its main button so the keyboard follows
  useEffect(() => { if (confirm) setTimeout(() => confirmBtn.current?.focus(), 30); }, [confirm]);

  useEffect(() => {
    if (!open) return;
    const init: Form = staff ? {
      full_name: staff.full_name, role: staff.role, title: staff.title ?? '', login: loginView(staff.login), branch_ids: staff.branch_ids,
      specialty: staff.specialty ?? '', share_percent: staff.default_share_percent != null ? String(Number(staff.default_share_percent)) : '0', service_ids: staff.service_ids ?? [],
    } : empty;
    setV(init); setInitial(init); setErrors({}); setFormError(null); setConfirm(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff]);

  const isDoctor = v.role === 'doctor';
  const services = useQuery({ queryKey: ['services', 'all-active'], queryFn: () => api('/services').then((r) => r.data as any[]), enabled: open && isDoctor });
  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const s of services.data ?? []) (g[s.category] ??= []).push(s);
    return g;
  }, [services.data]);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: '' })); };
  const toggle = (k: 'branch_ids' | 'service_ids', id: string) => { setV((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((i) => i !== id) : [...x[k], id] })); setErrors((x) => ({ ...x, [k]: '' })); };

  function validate() {
    const e: Record<string, string> = {};
    if (v.full_name.trim().length < 3) e.full_name = t('admin.form.errName');
    if ((isNew || v.login.trim() || initial.login) && !normalizeLogin(v.login)) e.login = t('admin.form.errLogin');
    if (!v.branch_ids.length) e.branch_ids = t('admin.form.errBranches');
    if (isDoctor) {
      if (v.specialty.trim().length < 2) e['doctor.specialty'] = t('admin.form.errSpecialty');
      const p = Number(v.share_percent);
      if (v.share_percent === '' || !Number.isFinite(p) || p < 0 || p > 100) e['doctor.share_percent'] = t('admin.form.errShare');
    }
    setErrors(e);
    return !Object.keys(e).length;
  }

  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['staff'] }); qc.invalidateQueries({ queryKey: ['doctors'] }); toast.success(msg); };
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.fields) setErrors(e.fields);
    setFormError(e instanceof Error ? e.message : t('admin.form.notSaved'));
  };

  const save = useMutation({
    mutationFn: () => {
      const doctor = isDoctor ? { specialty: v.specialty.trim(), share_percent: Number(v.share_percent), service_ids: v.service_ids } : undefined;
      if (isNew) return api('/staff', { method: 'POST', body: { full_name: v.full_name.trim(), role: v.role, title: v.title.trim() || null, login: v.login, branch_ids: v.branch_ids, doctor } });
      const body: any = {};
      if (v.full_name !== initial.full_name) body.full_name = v.full_name.trim();
      if (v.role !== initial.role) body.role = v.role;
      if (v.title !== initial.title) body.title = v.title.trim() || null;
      if (v.login !== initial.login) body.login = v.login;
      if (JSON.stringify(v.branch_ids) !== JSON.stringify(initial.branch_ids)) body.branch_ids = v.branch_ids;
      if (isDoctor && staff!.doctor_id) {
        const d: any = {};
        if (v.specialty !== initial.specialty) d.specialty = doctor!.specialty;
        if (v.share_percent !== initial.share_percent) d.share_percent = doctor!.share_percent;
        if ([...v.service_ids].sort().join() !== [...initial.service_ids].sort().join()) d.service_ids = v.service_ids;
        if (Object.keys(d).length) body.doctor = d;
      }
      return api(`/staff/${staff!.membership_id}`, { method: 'PATCH', body });
    },
    onSuccess: (r: any) => {
      done(isNew ? t('admin.form.added') : t('admin.form.saved'));
      if (isNew) onIssued({ name: v.full_name.trim(), login: r.data.login, temp_password: r.data.temp_password });
      onClose();
    },
    onError,
  });
  const reset = useMutation({
    mutationFn: () => api(`/staff/${staff!.membership_id}/reset-password`, { method: 'POST', body: {} }),
    onSuccess: (r: any) => { done(t('admin.form.tempIssued')); onIssued({ name: staff!.full_name, login: r.data.login, temp_password: r.data.temp_password }); onClose(); },
    onError: (e) => { setConfirm(null); onError(e); },
  });
  const status = useMutation({
    mutationFn: () => api(`/staff/${staff!.membership_id}`, { method: 'PATCH', body: { status: staff!.status === 'active' ? 'inactive' : 'active' } }),
    onSuccess: () => { done(staff!.status === 'active' ? t('admin.form.deactivated') : t('admin.form.activated')); onClose(); },
    onError: (e) => { setConfirm(null); onError(e); },
  });
  const submit = () => { setFormError(null); if (validate()) save.mutate(); };
  const canManage = staff && !staff.is_self;
  // demo-card staff keep their role and status so every visitor can sign in with the role cards (server: 403)
  const canChangeStatus = canManage && !staff.demo_card;

  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-2xl" title={isNew ? t('admin.staff.add') : t('admin.form.editTitle', { name: staff!.full_name })}
      footer={<>
        {canManage && !confirm && (staff.login || canChangeStatus) && <div className="mr-auto flex flex-wrap gap-2">
          {staff.login && <Button icon={<KeyRound className="h-4 w-4" />} onClick={() => setConfirm('reset')}>{t('admin.form.resetPassword')}</Button>}
          {canChangeStatus && <Button variant={staff.status === 'active' ? 'danger' : 'secondary'} icon={<Power className="h-4 w-4" />} onClick={() => setConfirm('status')}>{staff.status === 'active' ? t('admin.form.deactivate') : t('admin.form.activate')}</Button>}
        </div>}
        <ModalCancel />
        <Button variant="primary" loading={save.isPending} disabled={!isNew && !dirty} onClick={submit}>{isNew ? t('admin.form.addSubmit') : t('common.save')}</Button>
      </>}>
      <div className="space-y-4">
        {formError && <Alert tone="red">{formError}</Alert>}
        {confirm === 'reset' && staff && (
          <Alert tone="yellow" title={t('admin.form.resetTitle')}>
            {t('admin.form.resetText', { name: staff.full_name })}
            <div className="mt-2 flex gap-2"><Button ref={confirmBtn} size="sm" variant="primary" loading={reset.isPending} onClick={() => reset.mutate()}>{t('admin.form.resetYes')}</Button><Button size="sm" onClick={() => setConfirm(null)}>{t('admin.form.no')}</Button></div>
          </Alert>
        )}
        {confirm === 'status' && staff && (
          <Alert tone={staff.status === 'active' ? 'red' : 'yellow'} title={staff.status === 'active' ? t('admin.form.deactivateTitle') : t('admin.form.activateTitle')}>
            {staff.status === 'active'
              ? `${t('admin.form.deactivateText', { name: staff.full_name })}${staff.doctor_id ? ` ${t('admin.form.deactivateDoctor')}` : ''} ${t('admin.form.historyKept')}`
              : t('admin.form.activateText', { name: staff.full_name })}
            <div className="mt-2 flex gap-2"><Button ref={confirmBtn} size="sm" variant={staff.status === 'active' ? 'danger' : 'primary'} loading={status.isPending} onClick={() => status.mutate()}>{staff.status === 'active' ? t('admin.form.deactivateYes') : t('admin.form.activateYes')}</Button><Button size="sm" onClick={() => setConfirm(null)}>{t('admin.form.no')}</Button></div>
          </Alert>
        )}
        {staff?.is_self && <Alert tone="blue">{t('admin.form.selfNote')}</Alert>}
        {staff?.demo_card && !staff.is_self && <Alert tone="blue">{t('admin.form.demoNote')}</Alert>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('admin.form.name')} required error={errors.full_name}>
            {(id) => <Input id={id} value={v.full_name} onChange={set('full_name')} invalid={!!errors.full_name} placeholder={t('admin.form.namePlaceholder')} />}
          </Field>
          <Field label={t('admin.form.role')} required error={errors.role} hint={!isNew && staff?.role === 'doctor' ? t('admin.form.roleFixed') : undefined}>
            {(id) => <Select id={id} value={v.role} onChange={set('role')} disabled={!isNew && (staff!.role === 'doctor' || staff!.is_self || staff!.demo_card)}>
              {(isNew ? ROLES : staff!.role === 'doctor' ? ['doctor' as Role] : ROLES.filter((r) => r !== 'doctor')).map((r) => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}
            </Select>}
          </Field>
          <Field label={t('admin.form.login')} required={isNew || !!initial.login} error={errors.login} hint={t('admin.form.loginHint', { example: 'dilnoza.k' })}>
            {(id) => <Input id={id} value={v.login} onChange={set('login')} invalid={!!errors.login} autoComplete="off" />}
          </Field>
          <Field label={t('admin.form.position')} error={errors.title}>
            {(id) => <Input id={id} value={v.title} onChange={set('title')} placeholder={t('admin.form.positionPlaceholder')} />}
          </Field>
        </div>

        <fieldset disabled={!!staff?.is_self}>
          <legend className="text-sm font-semibold text-slate-800">{t('admin.form.branches')}<span className="text-red-700" aria-hidden="true"> *</span></legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {me.branches.map((b) => (
              <Checkbox key={b.id} checked={v.branch_ids.includes(b.id)} onChange={() => toggle('branch_ids', b.id)} aria-invalid={!!errors.branch_ids || undefined} label={b.name}
                rowClassName={cx('rounded-field border-2 px-3', v.branch_ids.includes(b.id) ? 'border-brand-400 bg-brand-50 !text-brand-900' : errors.branch_ids ? 'border-red-600' : 'border-slate-300')} />
            ))}
          </div>
          {errors.branch_ids && <p className="mt-1 text-sm font-medium text-red-700" role="alert">{errors.branch_ids}</p>}
        </fieldset>

        {isDoctor && (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Field label={t('admin.form.specialty')} required error={errors['doctor.specialty']}>
                {(id) => <Input id={id} value={v.specialty} onChange={set('specialty')} invalid={!!errors['doctor.specialty']} placeholder={t('admin.form.specialtyPlaceholder')} />}
              </Field>
              <Field label={t('admin.form.share')} required error={errors['doctor.share_percent']} hint={t('admin.form.shareHint')}>
                {(id) => <Input id={id} inputMode="decimal" value={v.share_percent} onChange={set('share_percent')} invalid={!!errors['doctor.share_percent']} />}
              </Field>
            </div>
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold text-slate-800">{t('admin.form.services')} <span className="text-small font-normal text-slate-600">{t('admin.form.servicesPicked', { n: v.service_ids.length })}</span></div>
              {services.isLoading ? <p className="mt-1 text-sm text-slate-600">{t('common.loading')}</p> : (
                <div className="mt-1 max-h-72 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                  {Object.entries(grouped).map(([cat, list]) => (
                    <div key={cat}>
                      <div className="text-small font-semibold text-slate-600">{t(`service.${cat}` as MessageKey)}</div>
                      <div className="mt-1 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                        {list.map((s) => (
                          <Checkbox key={s.id} rowClassName="text-sm" checked={v.service_ids.includes(s.id)} onChange={() => toggle('service_ids', s.id)} label={<span className="line-clamp-2">{s.name}</span>} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {isNew && <p className="mt-2 text-small text-slate-600">{t('admin.form.scheduleNext')}</p>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Shows a freshly issued temporary password once. It is not stored anywhere in the browser. */
export function TempPasswordModal({ issued, onClose }: { issued: Issued | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [issued]);
  if (!issued) return null;
  const text = `Med.uz.ai\n${t('admin.temp.clipboard', { login: loginView(issued.login), password: issued.temp_password })}`;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); toast.error(new Error(t('admin.temp.copyFailed'))); } };
  return (
    // shown once: until it is copied, Escape or a click outside asks before closing
    <Modal open onClose={onClose} dirty={!copied} title={t('admin.temp.title')} footer={<Button variant="primary" onClick={onClose}>{t('admin.temp.done')}</Button>}>
      <p className="text-sm text-slate-700">{t('admin.temp.for', { name: issued.name })}</p>
      <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-body">
        <div><span className="text-slate-600">{t('admin.temp.login')} </span>{loginView(issued.login)}</div>
        <div><span className="text-slate-600">{t('admin.temp.password')} </span><span className="select-all font-semibold tracking-wider text-slate-900">{issued.temp_password}</span></div>
      </div>
      <Button className="mt-3" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={copy}>{copied ? t('admin.temp.copied') : t('admin.temp.copy')}</Button>
      <div className="mt-4"><Alert tone="yellow" title={t('admin.temp.onceTitle')}>{t('admin.temp.onceText')}</Alert></div>
    </Modal>
  );
}
