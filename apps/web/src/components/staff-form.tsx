'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Power } from 'lucide-react';
import { normalizeLogin, ROLE_LABEL, SERVICE_CATEGORY_LABEL, type Role } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, cx, Field, Input, Modal, Select, useToast } from '@/components/ui';

export type StaffRow = {
  membership_id: string; full_name: string; login: string | null; role: Role; title: string | null; status: 'active' | 'inactive';
  branch_ids: string[]; branch_names: string[] | null; demo_card: boolean; is_self: boolean; has_password: boolean; must_change_password: boolean;
  last_login_at: string | null; locked: boolean | null; doctor_id: string | null; has_schedule: boolean; specialty: string | null; default_share_percent: number | null; service_ids: string[];
};
type Issued = { name: string; login: string; temp_password: string };
type Form = { full_name: string; role: Role; title: string; login: string; branch_ids: string[]; specialty: string; share_percent: string; service_ids: string[] };

const ROLES: Role[] = ['registrar', 'doctor', 'cashier', 'lab', 'manager'];
const loginView = (l: string | null) => (l ? (l.startsWith('+998') ? formatPhone(l) : l) : '');

/** Create a staff account or edit one. Password reset and (de)activation live here too, never for one's own account. */
export function StaffFormModal({ open, staff, onClose, onIssued }: { open: boolean; staff: StaffRow | null; onClose: () => void; onIssued: (i: Issued) => void }) {
  const { me, branchId } = useSession();
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
    if (v.full_name.trim().length < 3) e.full_name = 'F.I.Sh. kamida 3 belgi';
    if ((isNew || v.login.trim() || initial.login) && !normalizeLogin(v.login)) e.login = 'Telefon (+998 …) yoki lotin harflaridagi login (3–32 belgi)';
    if (!v.branch_ids.length) e.branch_ids = 'Kamida bitta filialni tanlang';
    if (isDoctor) {
      if (v.specialty.trim().length < 2) e['doctor.specialty'] = 'Mutaxassislikni kiriting';
      const p = Number(v.share_percent);
      if (v.share_percent === '' || !Number.isFinite(p) || p < 0 || p > 100) e['doctor.share_percent'] = '0–100 oralig‘ida';
    }
    setErrors(e);
    return !Object.keys(e).length;
  }

  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['staff'] }); qc.invalidateQueries({ queryKey: ['doctors'] }); toast.success(msg); };
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.fields) setErrors(e.fields);
    setFormError(e instanceof Error ? e.message : 'Saqlanmadi');
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
      done(isNew ? 'Xodim qo‘shildi' : 'O‘zgarishlar saqlandi');
      if (isNew) onIssued({ name: v.full_name.trim(), login: r.data.login, temp_password: r.data.temp_password });
      onClose();
    },
    onError,
  });
  const reset = useMutation({
    mutationFn: () => api(`/staff/${staff!.membership_id}/reset-password`, { method: 'POST', body: {} }),
    onSuccess: (r: any) => { done('Vaqtinchalik parol berildi'); onIssued({ name: staff!.full_name, login: r.data.login, temp_password: r.data.temp_password }); onClose(); },
    onError: (e) => { setConfirm(null); onError(e); },
  });
  const status = useMutation({
    mutationFn: () => api(`/staff/${staff!.membership_id}`, { method: 'PATCH', body: { status: staff!.status === 'active' ? 'inactive' : 'active' } }),
    onSuccess: () => { done(staff!.status === 'active' ? 'Xodim faolsizlantirildi — sessiyalari yopildi' : 'Xodim faollashtirildi'); onClose(); },
    onError: (e) => { setConfirm(null); onError(e); },
  });
  const submit = () => { setFormError(null); if (validate()) save.mutate(); };
  const canManage = staff && !staff.is_self;

  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-2xl" title={isNew ? 'Xodim qo‘shish' : `${staff!.full_name} · tahrirlash`}
      footer={<>
        {canManage && !confirm && <div className="mr-auto flex gap-2">
          {staff.login && <Button size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={() => setConfirm('reset')}>Parolni tiklash</Button>}
          <Button size="sm" variant={staff.status === 'active' ? 'danger' : 'secondary'} icon={<Power className="h-4 w-4" />} onClick={() => setConfirm('status')}>{staff.status === 'active' ? 'Faolsizlantirish' : 'Faollashtirish'}</Button>
        </div>}
        <Button onClick={onClose}>Bekor qilish</Button>
        <Button variant="primary" loading={save.isPending} disabled={!isNew && !dirty} onClick={submit}>{isNew ? 'Xodimni qo‘shish' : 'Saqlash'}</Button>
      </>}>
      <div className="space-y-4">
        {formError && <Alert tone="red">{formError}</Alert>}
        {confirm === 'reset' && staff && (
          <Alert tone="yellow" title="Parolni tiklaysizmi?">
            {staff.full_name} uchun yangi vaqtinchalik parol yaratiladi, eski parol ishlamay qoladi va ochiq sessiyalari yopiladi. Blok bo‘lsa, ochiladi.
            <div className="mt-2 flex gap-2"><Button size="sm" variant="primary" loading={reset.isPending} onClick={() => reset.mutate()}>Ha, tiklash</Button><Button size="sm" onClick={() => setConfirm(null)}>Yo‘q</Button></div>
          </Alert>
        )}
        {confirm === 'status' && staff && (
          <Alert tone={staff.status === 'active' ? 'red' : 'yellow'} title={staff.status === 'active' ? 'Xodimni faolsizlantirasizmi?' : 'Xodimni faollashtirasizmi?'}>
            {staff.status === 'active'
              ? `${staff.full_name} darhol tizimdan chiqariladi va qayta kira olmaydi.${staff.doctor_id ? ' Shifokorga yangi qabul yozilmaydi; mavjud qabullarini tekshiring.' : ''} Tarixiy yozuvlar saqlanadi.`
              : `${staff.full_name} yana tizimga kira oladi.`}
            <div className="mt-2 flex gap-2"><Button size="sm" variant={staff.status === 'active' ? 'danger' : 'primary'} loading={status.isPending} onClick={() => status.mutate()}>Ha</Button><Button size="sm" onClick={() => setConfirm(null)}>Yo‘q</Button></div>
          </Alert>
        )}
        {staff?.is_self && <p className="text-xs text-slate-500">Bu sizning akkauntingiz: rol, holat va filiallarni boshqa rahbar o‘zgartiradi. Parol — yuqoridagi kalit belgisi orqali.</p>}
        {staff?.demo_card && !staff.is_self && <p className="text-xs text-slate-500">Demo kartadagi xodim: barcha uchun demo ishlashi uchun uni o‘chirib yoki rolini o‘zgartirib bo‘lmaydi.</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="F.I.Sh." required error={errors.full_name}>
            {(id) => <Input id={id} value={v.full_name} onChange={set('full_name')} invalid={!!errors.full_name} placeholder="Familiya Ism Sharif" />}
          </Field>
          <Field label="Rol" required error={errors.role} hint={!isNew && staff?.role === 'doctor' ? 'Shifokor roli yaratilgandan keyin o‘zgarmaydi' : undefined}>
            {(id) => <Select id={id} value={v.role} onChange={set('role')} disabled={!isNew && (staff!.role === 'doctor' || staff!.is_self)}>
              {(isNew ? ROLES : staff!.role === 'doctor' ? ['doctor' as Role] : ROLES.filter((r) => r !== 'doctor')).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>}
          </Field>
          <Field label="Telefon yoki login" required error={errors.login} hint="Xodim shu bilan kiradi. Masalan: +998 90 123 45 67 yoki dilnoza.k">
            {(id) => <Input id={id} value={v.login} onChange={set('login')} invalid={!!errors.login} autoComplete="off" />}
          </Field>
          <Field label="Lavozim" error={errors.title}>
            {(id) => <Input id={id} value={v.title} onChange={set('title')} placeholder="Masalan: Katta registrator" />}
          </Field>
        </div>

        <fieldset disabled={!!staff?.is_self}>
          <legend className="text-[13px] font-medium text-slate-700">Filiallar <span className="text-red-600">*</span></legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {me.branches.map((b) => (
              <label key={b.id} className={cx('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm', v.branch_ids.includes(b.id) ? 'border-brand-400 bg-brand-50 text-brand-900' : 'border-slate-300')}>
                <input type="checkbox" className="accent-brand-600" checked={v.branch_ids.includes(b.id)} onChange={() => toggle('branch_ids', b.id)} />{b.name}
              </label>
            ))}
          </div>
          {errors.branch_ids && <p className="mt-1 text-xs text-red-600" role="alert">{errors.branch_ids}</p>}
        </fieldset>

        {isDoctor && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
              <Field label="Mutaxassislik" required error={errors['doctor.specialty']}>
                {(id) => <Input id={id} value={v.specialty} onChange={set('specialty')} invalid={!!errors['doctor.specialty']} placeholder="Masalan: Kardiolog" />}
              </Field>
              <Field label="Ulush, %" error={errors['doctor.share_percent']} hint="Xizmat qiymatidan">
                {(id) => <Input id={id} inputMode="decimal" value={v.share_percent} onChange={set('share_percent')} invalid={!!errors['doctor.share_percent']} />}
              </Field>
            </div>
            <div>
              <div className="text-[13px] font-medium text-slate-700">Bajaradigan xizmatlari <span className="font-normal text-slate-500">· {v.service_ids.length} ta tanlangan</span></div>
              {services.isLoading ? <p className="mt-1 text-xs text-slate-500">Yuklanmoqda…</p> : (
                <div className="mt-1 max-h-56 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-2">
                  {Object.entries(grouped).map(([cat, list]) => (
                    <div key={cat}>
                      <div className="text-2xs font-semibold uppercase tracking-wide text-slate-500">{SERVICE_CATEGORY_LABEL[cat] ?? cat}</div>
                      <div className="mt-1 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                        {list.map((s) => (
                          <label key={s.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-[13px]">
                            <input type="checkbox" className="accent-brand-600" checked={v.service_ids.includes(s.id)} onChange={() => toggle('service_ids', s.id)} />
                            <span className="truncate">{s.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {isNew && <p className="mt-1 text-xs text-slate-500">Saqlangach ro‘yxatda shifokorni tanlang → «Jadvalni tahrirlash». Jadvalsiz shifokorga qabul yozilmaydi.</p>}
            </div>
          </div>
        )}
        {isNew && <p className="text-xs text-slate-500">Saqlangach vaqtinchalik parol bir marta ko‘rsatiladi. Xodim birinchi kirishda o‘z parolini o‘rnatadi.</p>}
      </div>
    </Modal>
  );
}

/** Shows a freshly issued temporary password once. It is not stored anywhere in the browser. */
export function TempPasswordModal({ issued, onClose }: { issued: Issued | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [issued]);
  if (!issued) return null;
  const text = `Med.uz.ai\nLogin: ${loginView(issued.login)}\nVaqtinchalik parol: ${issued.temp_password}\nBirinchi kirishda yangi parol o‘rnating.`;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } };
  return (
    <Modal open onClose={onClose} title="Vaqtinchalik parol" footer={<Button variant="primary" onClick={onClose}>Tushunarli, yopish</Button>}>
      <p className="text-sm text-slate-700">{issued.name} uchun kirish ma’lumotlari:</p>
      <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-[15px]">
        <div><span className="text-slate-500">Login: </span>{loginView(issued.login)}</div>
        <div><span className="text-slate-500">Parol: </span><span className="select-all font-semibold tracking-wider text-slate-900">{issued.temp_password}</span></div>
      </div>
      <Button size="sm" className="mt-3" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={copy}>{copied ? 'Nusxa olindi' : 'Nusxa olish'}</Button>
      <div className="mt-4"><Alert tone="yellow" title="Bu parol boshqa ko‘rsatilmaydi">Xodimga shaxsan bering. Birinchi kirishda u o‘z parolini o‘rnatadi. Yo‘qolsa — «Parolni tiklash».</Alert></div>
    </Modal>
  );
}
