'use client';
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatSom } from '@/lib/format';

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' '); }

// ---------- Button ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md'; loading?: boolean; icon?: React.ReactNode;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  // Liquid Glass: the primary action is tinted glass, the others clear glass capsules (docs/UI_GUIDE.md)
  const styles = {
    primary: 'glass-btn glass-btn-tint border-transparent',
    secondary: 'glass-btn border-transparent',
    ghost: 'bg-transparent text-brand-700 hover:bg-white/60 border-transparent rounded-full',
    danger: 'glass-btn border-transparent !text-red-700',
    success: 'glass-btn border-transparent !bg-emerald-700/90 !text-white hover:!bg-emerald-800',
  }[variant];
  return (
    <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined} className={cx('press inline-flex items-center justify-center gap-2 rounded-full border-2 font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-60 aria-busy:opacity-100 whitespace-nowrap',
      size === 'sm' ? 'min-h-10 px-4 text-sm' : 'min-h-12 px-5 text-[0.9375rem]', styles, className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ href, children, variant = 'secondary', icon, className, size = 'md', target }: { href: string; children: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; icon?: React.ReactNode; className?: string; size?: 'sm' | 'md'; target?: '_blank' }) {
  const styles = { primary: 'glass-btn glass-btn-tint border-transparent', secondary: 'glass-btn border-transparent', ghost: 'border-transparent text-brand-700 hover:bg-white/60' }[variant];
  return <Link href={href} target={target} rel={target ? 'noopener' : undefined} className={cx('press inline-flex items-center justify-center gap-2 rounded-full border-2 font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 whitespace-nowrap', size === 'sm' ? 'min-h-10 px-4 text-sm' : 'min-h-12 px-5 text-[0.9375rem]', styles, className)}>{icon}{children}</Link>;
}

// ---------- Form fields ----------
/** Lets Input/Textarea/Select inside a Field point screen readers at its error or hint (aria-describedby). */
const FieldCtx = createContext<{ describedBy?: string }>({});
export function Field({ label, error, hint, required, children, className }: { label: string; error?: string; hint?: string; required?: boolean; children: (id: string) => React.ReactNode; className?: string }) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">{label}{required && <span className="text-red-700" aria-hidden="true"> *</span>}</label>
      <FieldCtx.Provider value={{ describedBy: error || hint ? msgId : undefined }}>{children(id)}</FieldCtx.Provider>
      {error ? <p id={msgId} className="text-sm font-medium text-red-700" role="alert">{error}</p> : hint ? <p id={msgId} className="text-[0.8125rem] text-slate-600">{hint}</p> : null}
    </div>
  );
}
const W = (c?: string) => (c && /(^|\s)w-/.test(c) ? '' : 'w-full');
const inputBase = 'rounded-xl border-2 bg-white px-3 text-[0.9375rem] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-amber-300 focus:border-brand-600 disabled:bg-slate-50 disabled:text-slate-600';
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...p }, ref) {
  const f = useContext(FieldCtx);
  return <input ref={ref} className={cx(inputBase, W(className), 'h-11', invalid ? 'border-red-600' : 'border-slate-300', className)} aria-invalid={invalid || undefined} aria-describedby={f.describedBy} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...p }, ref) {
  const f = useContext(FieldCtx);
  return <textarea ref={ref} className={cx(inputBase, W(className), 'py-2.5 leading-relaxed', invalid ? 'border-red-600' : 'border-slate-300', className)} aria-invalid={invalid || undefined} aria-describedby={f.describedBy} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...p }, ref) {
  const f = useContext(FieldCtx);
  return <select ref={ref} className={cx(inputBase, W(className), 'h-11 pr-8', invalid ? 'border-red-600' : 'border-slate-300', className)} aria-invalid={invalid || undefined} aria-describedby={f.describedBy} {...p}>{children}</select>;
});

// ---------- Badges ----------
const TONES = {
  gray: 'bg-slate-100 text-slate-800 ring-slate-200', blue: 'bg-sky-50 text-sky-800 ring-sky-200', teal: 'bg-brand-50 text-brand-800 ring-brand-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200', green: 'bg-emerald-50 text-emerald-800 ring-emerald-200', red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};
export type Tone = keyof typeof TONES;
export function Badge({ tone = 'gray', children, icon, className }: { tone?: Tone; children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold ring-1 ring-inset whitespace-nowrap', TONES[tone], className)}>{icon}{children}</span>;
}

// ---------- Card / page ----------
export function Card({ children, className, title, actions, padded = true }: { children: React.ReactNode; className?: string; title?: React.ReactNode; actions?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={cx('surface', className)}>
      {(title || actions) && <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-5 py-2.5"><h2 className="text-base font-bold text-slate-900">{title}</h2><div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div></header>}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}
/** Page title (h1), one short line under it at most, and the page's primary action on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0"><h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-slate-900">{title}</h1>{subtitle && <p className="mt-1 text-[0.9375rem] text-slate-600">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A money amount for key numbers: the digits never split, the currency word is smaller (and may move under on a narrow card). */
export function Money({ tiyin, minus }: { tiyin: number; minus?: boolean }) {
  const num = formatSom(tiyin, false);
  const cur = formatSom(tiyin).slice(num.length).trim();
  return <span className="inline-flex flex-wrap items-baseline gap-x-1.5"><span className="whitespace-nowrap">{minus && tiyin ? '−' : ''}{num}</span><span className="whitespace-nowrap text-[0.875rem] font-semibold text-slate-600">{cur}</span></span>;
}

/** A key number: label on one line, the value large, one short line under it. A link when `href` is given. */
export function StatCard({ icon, label, value, sub, href, loading, tone = 'default', className }: {
  icon?: React.ReactNode; label: string; value?: React.ReactNode; sub?: React.ReactNode; href?: string; loading?: boolean; tone?: 'default' | 'danger' | 'success'; className?: string;
}) {
  const body = (
    <div className={cx('surface flex h-full min-w-0 flex-col px-4 py-4 transition-colors 2xl:px-5', href && 'hover:!border-brand-300')}>
      <div className="flex items-center gap-2 text-[0.875rem] font-semibold text-slate-600">
        {icon && <span className={cx('shrink-0 [&>svg]:h-[1.125rem] [&>svg]:w-[1.125rem]', tone === 'danger' ? 'text-red-600' : tone === 'success' ? 'text-emerald-700' : 'text-brand-600')}>{icon}</span>}
        {/* wraps on a narrow tile (two tiles per row on a phone) instead of being cut */}
        <span className="line-clamp-2 leading-snug">{label}</span>
      </div>
      {loading ? <Skeleton className="mt-2.5 h-7 w-28" /> : <div className={cx('mt-2 text-[1.375rem] font-bold leading-none tabular-nums tracking-tight 2xl:text-[1.5rem]', tone === 'danger' ? 'text-red-700' : tone === 'success' ? 'text-emerald-800' : 'text-slate-900')}>{value}</div>}
      {loading ? <Skeleton className="mt-2.5 h-3 w-32" /> : sub != null && <div className="mt-2 line-clamp-2 text-[0.8125rem] leading-snug text-slate-600">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className={cx('block rounded-[1.375rem] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', className)}>{body}</Link> : <div className={className}>{body}</div>;
}

/** Filter bar at the top of a card: filters on the left, secondary actions (export…) on the right, one row when it fits. */
export function Toolbar({ children, actions, className }: { children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-slate-100 px-5 py-3 first:rounded-t-[inherit]', className)}>
      <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-2.5 sm:basis-0">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- States ----------
export function Skeleton({ className }: { className?: string }) { return <div className={cx('animate-pulse rounded bg-slate-200/70', className)} />; }
export function LoadingRows({ rows = 6 }: { rows?: number }) {
  const t = useT();
  return <div className="space-y-2 p-4" aria-busy="true" aria-label={t('common.loading')}>{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
}
/** Nothing to show: one line (+ optional short text and one action). `compact` inside a small card. */
export function EmptyState({ title, text, action, icon, compact }: { title: string; text?: string; action?: React.ReactNode; icon?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 px-6 text-center', compact ? 'py-6' : 'py-10')}>
      <div className="text-slate-400 [&>svg]:h-7 [&>svg]:w-7">{icon ?? <Info />}</div>
      <p className="text-base font-semibold text-slate-800">{title}</p>
      {text && <p className="max-w-md text-sm text-slate-600">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const e = error as ApiError;
  const msg = e?.status === 403 ? t('state.forbidden') : e?.status === 404 ? t('state.notFound') : e?.message || t('state.loadFailed');
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
      <XCircle className="h-8 w-8 text-red-400" />
      <p className="text-base text-slate-800">{msg}</p>
      {onRetry && e?.status !== 403 && e?.status !== 404 && <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>{t('common.retry')}</Button>}
    </div>
  );
}
export function Alert({ tone = 'yellow', children, title }: { tone?: 'yellow' | 'red' | 'blue' | 'green'; title?: string; children: React.ReactNode }) {
  const s = { yellow: 'bg-amber-50 border-amber-200 text-amber-900', red: 'bg-red-50 border-red-200 text-red-900', blue: 'bg-sky-50 border-sky-200 text-sky-900', green: 'bg-emerald-50 border-emerald-200 text-emerald-900' }[tone];
  const Icon = tone === 'green' ? CheckCircle2 : tone === 'blue' ? Info : AlertTriangle;
  return <div className={cx('flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm', s)} role={tone === 'red' ? 'alert' : undefined}><Icon className="mt-0.5 h-5 w-5 shrink-0" /><div>{title && <p className="font-semibold">{title}</p>}{children}</div></div>;
}

// ---------- Table ----------
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  // focusable, so a wide table can be scrolled sideways with the keyboard
  return <div tabIndex={0} className={cx('overflow-x-auto rounded-[inherit] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', className)}><table className="w-full text-left text-sm">{children}</table></div>;
}
export function Th({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <th scope="col" className={cx('sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[0.8125rem] font-semibold text-slate-600 whitespace-nowrap', right && 'text-right', className)}>{children}</th>;
}
export function Td({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <td className={cx('border-b border-slate-100 px-3 py-2.5 align-middle', right && 'text-right tabular-nums whitespace-nowrap', className)}>{children}</td>;
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm text-slate-700">
      <span>{t('common.found', { n: total })}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('common.prevPage')}><ChevronLeft className="h-5 w-5" /></Button>
        <span>{page} / {pages}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('common.nextPage')}><ChevronRight className="h-5 w-5" /></Button>
      </div>
    </div>
  );
}

// ---------- Tabs ----------
// ---------- Sliding pill ----------
/**
 * The raised capsule of a segmented control / tab bar. It is one element that slides (on the spring) to whatever
 * child of `container` carries `data-active="true"`; the items themselves only change their text colour.
 * The container is `relative`; the pill sits under the items (z-0), so give the items `relative z-[1]`.
 */
export function SlidingPill({ container, active, className }: { container: React.RefObject<HTMLElement | null>; active: string | number | boolean; className?: string }) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const ready = useRef(false);
  // useEffect, not useLayoutEffect: the container's ref is attached after this child's layout effects would run
  useEffect(() => {
    const c = container.current; if (!c) return;
    const measure = () => {
      const el = c.querySelector<HTMLElement>('[data-active="true"]');
      if (!el) { setBox(null); return; }
      setBox((b) => (b && b.x === el.offsetLeft && b.y === el.offsetTop && b.w === el.offsetWidth && b.h === el.offsetHeight) ? b : { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useLayoutEffect(() => { if (box) { const t = setTimeout(() => { ready.current = true; }, 50); return () => clearTimeout(t); } }, [box]);
  if (!box) return null;
  // the first position is taken without a transition (no slide in from the corner); .glass > * would make it relative
  return <div aria-hidden="true" className={cx('pill pointer-events-none !absolute left-0 top-0 !z-0', !ready.current && '!transition-none', className)}
    style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }} />;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number }[] }) {
  const list = useRef<HTMLDivElement>(null);
  // a selected tab outside the visible strip (narrow card, link to ?status=…) is scrolled into view
  // only the strip scrolls (sideways): scrollIntoView would also move the page under the floating bars on a phone
  useEffect(() => {
    const strip = list.current, el = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !el || strip.scrollWidth <= strip.clientWidth) return;
    const left = el.offsetLeft - strip.offsetLeft, right = left + el.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left - 8;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 8;
  }, [value]);
  return (
    <div ref={list} className="relative flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-slate-100 p-1" role="tablist">
      <SlidingPill container={list} active={value} className="rounded-full bg-white shadow-[0_2px_8px_rgba(15,23,42,0.12)]" />
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} data-active={value === it.value} onClick={() => onChange(it.value)}
          className={cx('press relative z-[1] min-h-10 whitespace-nowrap rounded-full px-4 text-[0.9375rem] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', value === it.value ? 'text-brand-800' : 'text-slate-600 hover:text-slate-900')}>
          {it.label}{it.count != null && <span className="ml-1.5 rounded-full bg-slate-200/80 px-1.5 text-xs text-slate-700">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Modal ----------
/** The modal's guarded close: asks first when the dialog holds typed data (`dirty`), exactly like Esc, X and the backdrop. */
const ModalCloseCtx = createContext<() => void>(() => undefined);
export function useModalClose() { return useContext(ModalCloseCtx); }
/** Footer «Bekor qilish»/«Ortga»: closes through the modal's guarded close, so typed input is never dropped without asking. */
export function ModalCancel({ children, ...rest }: Omit<BtnProps, 'onClick'>) {
  const t = useT();
  const close = useModalClose();
  return <Button {...rest} onClick={close}>{children ?? t('common.cancel')}</Button>;
}
export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg', dirty = false }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: string; dirty?: boolean;
}) {
  const t = useT();
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const tryClose = useCallback(() => { if (dirty) setConfirming(true); else onClose(); }, [dirty, onClose]);
  // the question gets the focus, so a keyboard user hears it and «Qolish» is one Enter away
  useEffect(() => { if (confirming) panel.current?.querySelector<HTMLElement>('[data-confirm-stay]')?.focus(); }, [confirming]);
  useEffect(() => {
    if (!open) { setConfirming(false); return; }
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])]
      .filter((el) => el.offsetParent !== null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); tryClose(); return; }
      if (e.key !== 'Tab') return;
      // keep Tab inside the dialog: the page behind is not reachable while it is open
      const els = focusables();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.current?.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panel.current?.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    // first focus: an explicit autofocus, else the first text field, else the first action (never the close X)
    setTimeout(() => (panel.current?.querySelector<HTMLElement>('[autofocus],[data-autofocus]')
      ?? panel.current?.querySelector<HTMLElement>('textarea:not([disabled]),input:not([disabled]):not([type=checkbox]):not([type=radio]),select:not([disabled])')
      ?? panel.current?.querySelector<HTMLElement>('button:not([data-close]):not([disabled])'))?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, tryClose]);
  if (!open || typeof document === 'undefined') return null;
  // rendered at the end of <body>: never inherits table/space-y styles of the place that opened it
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 pt-[4vh] backdrop-blur-sm print:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('modal-panel flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-[1.75rem] border border-white bg-white text-left shadow-[0_30px_60px_-20px_rgba(10,30,70,0.45)]', width)}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 id={titleId} className="min-w-0 text-lg font-bold text-slate-900">{title}</h2>
          <button data-close onClick={tryClose} className="press shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" aria-label={t('common.close')}><X className="h-5 w-5" /></button>
        </div>
        {confirming && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
            <span>{t('state.unsavedClose')}</span>
            <div className="flex gap-2"><Button size="sm" data-confirm-stay onClick={() => setConfirming(false)}>{t('common.stay')}</Button><Button size="sm" variant="danger" onClick={onClose}>{t('common.close')}</Button></div>
          </div>
        )}
        <ModalCloseCtx.Provider value={tryClose}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {/* on a phone the buttons share the row's width instead of wrapping onto two rows */}
          {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-b-[1.75rem] border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5 [&>*]:flex-1 sm:[&>*]:flex-none">{footer}</div>}
        </ModalCloseCtx.Provider>
      </div>
    </div>,
    document.body,
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
      {/* errors are announced at once (role=alert, assertive); success and info politely */}
      {/* below lg the phone tab bar sits at the bottom: toasts stay above it */}
      <div className="pointer-events-none fixed bottom-24 right-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 print:hidden lg:bottom-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} aria-live={t.tone === 'error' ? 'assertive' : undefined} className={cx('toast-in pointer-events-auto flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-[0.9375rem] font-medium shadow-lg backdrop-blur', t.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : t.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-sky-200 bg-sky-50 text-sky-900')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : t.tone === 'error' ? <XCircle className="mt-0.5 h-5 w-5 shrink-0" /> : <Info className="mt-0.5 h-5 w-5 shrink-0" />}
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
  return <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-slate-600">{k}</span><span className="text-right font-medium text-slate-800">{v}</span></div>;
}
export function DemoTag({ children }: { children?: React.ReactNode }) {
  const t = useT();
  return <span className="rounded border border-dashed border-slate-400 px-1.5 py-0.5 text-2xs font-medium text-slate-600">{children ?? t('common.demoData')}</span>;
}
