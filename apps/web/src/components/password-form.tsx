'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { passwordChangeSchema, PASSWORD_RULE } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, cx, Field, Input, useToast } from '@/components/ui';

/** Change own password (current + new + repeat). The server re-checks every rule. */
export function PasswordForm({ onDone, submitLabel, className }: { onDone: () => void; submitLabel: string; className?: string }) {
  const toast = useToast();
  const [v, setV] = useState({ current_password: '', new_password: '', repeat: '' });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: '' })); };

  const save = useMutation({
    mutationFn: () => api('/auth/password', { method: 'POST', body: { current_password: v.current_password, new_password: v.new_password } }),
    onSuccess: () => { toast.success('Parol o‘zgartirildi. Boshqa qurilmalardagi sessiyalar yopildi.'); onDone(); },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else setFormError(e instanceof Error ? e.message : 'Saqlanmadi');
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string> = {};
    const r = passwordChangeSchema.safeParse({ current_password: v.current_password, new_password: v.new_password });
    if (!r.success) for (const i of r.error.issues) errs[String(i.path[0])] ??= i.message;
    if (v.repeat !== v.new_password) errs.repeat = 'Parollar mos emas';
    setErrors(errs);
    if (!Object.keys(errs).length) save.mutate();
  }

  const type = show ? 'text' : 'password';
  return (
    <form onSubmit={submit} className={cx('space-y-3', className)} noValidate>
      {formError && <Alert tone="red">{formError}</Alert>}
      <Field label="Joriy parol" required error={errors.current_password}>
        {(id) => <Input id={id} type={type} autoComplete="current-password" value={v.current_password} onChange={set('current_password')} invalid={!!errors.current_password} />}
      </Field>
      <Field label="Yangi parol" required error={errors.new_password} hint={PASSWORD_RULE}>
        {(id) => <Input id={id} type={type} autoComplete="new-password" value={v.new_password} onChange={set('new_password')} invalid={!!errors.new_password} />}
      </Field>
      <Field label="Yangi parolni takrorlang" required error={errors.repeat}>
        {(id) => <Input id={id} type={type} autoComplete="new-password" value={v.repeat} onChange={set('repeat')} invalid={!!errors.repeat} />}
      </Field>
      <div className="flex items-center justify-between gap-3 pt-1">
        <button type="button" onClick={() => setShow((s) => !s)} className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{show ? 'Yashirish' : 'Ko‘rsatish'}
        </button>
        <Button type="submit" variant="primary" loading={save.isPending}>{submitLabel}</Button>
      </div>
    </form>
  );
}
