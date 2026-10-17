'use client';
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { ApiError } from '@/lib/api';

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' '); }

// ---------- Button ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md'; loading?: boolean; icon?: React.ReactNode;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 border-brand-600 shadow-sm',
    secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300 shadow-sm',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
    danger: 'bg-white text-red-700 hover:bg-red-50 border-red-300',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600 shadow-sm',
  }[variant];
  return (
    <button ref={ref} disabled={disabled || loading} className={cx('inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
      size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm', styles, className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ href, children, variant = 'secondary', icon, className, size = 'md' }: { href: string; children: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; icon?: React.ReactNode; className?: string; size?: 'sm' | 'md' }) {
  const styles = { primary: 'bg-brand-600 text-white hover:bg-brand-700 border-brand-600', secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300', ghost: 'border-transparent text-slate-600 hover:bg-slate-100' }[variant];
  return <Link href={href} className={cx('inline-flex items-center gap-1.5 rounded-md border font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 whitespace-nowrap', size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm', styles, className)}>{icon}{children}</Link>;
}

// ---------- Form fields ----------
export function Field({ label, error, hint, required, children, className }: { label: string; error?: string; hint?: string; required?: boolean; children: (id: string) => React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-slate-700">{label}{required && <span className="text-red-600"> *</span>}</label>
      {children(id)}
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
const W = (c?: string) => (c && /(^|\s)w-/.test(c) ? '' : 'w-full');
const inputBase = 'rounded-md border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:bg-slate-50 disabled:text-slate-500';
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...p }, ref) {
  return <input ref={ref} className={cx(inputBase, W(className), 'h-9', invalid ? 'border-red-400' : 'border-slate-300', className)} aria-invalid={invalid || undefined} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...p }, ref) {
  return <textarea ref={ref} className={cx(inputBase, W(className), 'py-2 leading-relaxed', invalid ? 'border-red-400' : 'border-slate-300', className)} aria-invalid={invalid || undefined} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...p }, ref) {
  return <select ref={ref} className={cx(inputBase, W(className), 'h-9 pr-8', invalid ? 'border-red-400' : 'border-slate-300', className)} aria-invalid={invalid || undefined} {...p}>{children}</select>;
});

// ---------- Badges ----------
const TONES = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200', blue: 'bg-sky-50 text-sky-800 ring-sky-200', teal: 'bg-brand-50 text-brand-800 ring-brand-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200', green: 'bg-emerald-50 text-emerald-800 ring-emerald-200', red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};
export type Tone = keyof typeof TONES;
export function Badge({ tone = 'gray', children, icon, className }: { tone?: Tone; children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', TONES[tone], className)}>{icon}{children}</span>;
}

// ---------- Card / page ----------
export function Card({ children, className, title, actions, padded = true }: { children: React.ReactNode; className?: string; title?: React.ReactNode; actions?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5"><h2 className="text-sm font-semibold text-slate-800">{title}</h2><div className="flex items-center gap-2">{actions}</div></header>}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-slate-900">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- States ----------
export function Skeleton({ className }: { className?: string }) { return <div className={cx('animate-pulse rounded bg-slate-200/70', className)} />; }
export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return <div className="space-y-2 p-4" aria-busy="true" aria-label="Yuklanmoqda">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
}
export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-slate-300">{icon ?? <Info className="h-8 w-8" />}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {text && <p className="max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as ApiError;
  const msg = e?.status === 403 ? 'Bu bo‘limni ko‘rish uchun ruxsatingiz yo‘q.' : e?.status === 404 ? 'Ma’lumot topilmadi yoki sizga tegishli emas.' : e?.message || 'Ma’lumotni yuklab bo‘lmadi.';
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
      <XCircle className="h-8 w-8 text-red-400" />
      <p className="text-sm text-slate-700">{msg}</p>
      {onRetry && e?.status !== 403 && e?.status !== 404 && <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>Qayta urinish</Button>}
    </div>
  );
}
export function Alert({ tone = 'yellow', children, title }: { tone?: 'yellow' | 'red' | 'blue' | 'green'; title?: string; children: React.ReactNode }) {
  const s = { yellow: 'bg-amber-50 border-amber-200 text-amber-900', red: 'bg-red-50 border-red-200 text-red-900', blue: 'bg-sky-50 border-sky-200 text-sky-900', green: 'bg-emerald-50 border-emerald-200 text-emerald-900' }[tone];
  const Icon = tone === 'green' ? CheckCircle2 : tone === 'blue' ? Info : AlertTriangle;
  return <div className={cx('flex gap-2 rounded-md border px-3 py-2 text-sm', s)} role={tone === 'red' ? 'alert' : undefined}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><div>{title && <p className="font-medium">{title}</p>}{children}</div></div>;
}

// ---------- Table ----------
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('overflow-x-auto', className)}><table className="w-full text-left text-sm">{children}</table></div>;
}
export function Th({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <th scope="col" className={cx('sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap', right && 'text-right', className)}>{children}</th>;
}
export function Td({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <td className={cx('border-b border-slate-100 px-3 py-2 align-middle', right && 'text-right tabular-nums whitespace-nowrap', className)}>{children}</td>;
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
      <span>Topildi: <b className="text-slate-800">{total}</b></span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Oldingi sahifa"><ChevronLeft className="h-4 w-4" /></Button>
        <span>{page} / {pages}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Keyingi sahifa"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

// ---------- Tabs ----------
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', value === it.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {it.label}{it.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg', dirty = false }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: string; dirty?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const tryClose = useCallback(() => { if (dirty) setConfirming(true); else onClose(); }, [dirty, onClose]);
  useEffect(() => {
    if (!open) { setConfirming(false); return; }
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); tryClose(); } };
    document.addEventListener('keydown', onKey);
    setTimeout(() => panel.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, tryClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh] print:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" className={cx('w-full rounded-lg bg-white shadow-xl', width)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button data-close onClick={tryClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Yopish"><X className="h-5 w-5" /></button>
        </div>
        {confirming && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
            <span>Saqlanmagan o‘zgarishlar o‘chadi. Oynani yopasizmi?</span>
            <div className="flex gap-2"><Button size="sm" onClick={() => setConfirming(false)}>Qolish</Button><Button size="sm" variant="danger" onClick={onClose}>Yopish</Button></div>
          </div>
        )}
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Toasts ----------
type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2 print:hidden" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm shadow-lg', t.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : t.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-sky-200 bg-sky-50 text-sky-900')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : t.tone === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const push = useContext(ToastCtx);
  return { success: (t: string) => push('success', t), error: (e: unknown) => push('error', e instanceof Error ? e.message : String(e)), info: (t: string) => push('info', t) };
}

// ---------- misc ----------
export function KeyVal({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-slate-500">{k}</span><span className="text-right font-medium text-slate-800">{v}</span></div>;
}
export function DemoTag({ children = 'Demo ma’lumoti' }: { children?: React.ReactNode }) {
  return <span className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-slate-500">{children}</span>;
}
