'use client';
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { LOCALE_TAG } from '@meduza/contracts';
import { ApiError } from '@/lib/api';
import { useI18n, useT } from '@/lib/i18n';
import { formatSom } from '@/lib/format';

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' '); }

// ---------- Tokens in class form (docs/UI_GUIDE.md §2) ----------
/** Keyboard focus: one amber ring (the `focus` token) drawn outside the control with a small gap, so it never reads as
 *  the selected state (a selected item is a white pill or a blue fill, never amber). */
export const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
/** The same ring drawn inside the control: for items in a strip that clips (tabs, segments, list rows). */
export const FOCUS_RING_INSET = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus';
/** `prefers-reduced-motion`: smooth scrolling only when the person did not ask for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

// ---------- Button ----------
/**
 * Sizes (docs/UI_GUIDE.md §2): `md` = the control height (2.75rem = 49.5px), shared with Input/Select/Segmented in a row;
 * `sm` (= `compact`) = 2.5rem = 45px for dense tables and toolbars; `icon` / `icon-sm` = a square of those heights, and
 * then an aria-label is required. Every size stays ≥ 44px rendered.
 */
type BtnBase = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; loading?: boolean; icon?: React.ReactNode };
type BtnProps = BtnBase & ({ size?: 'sm' | 'compact' | 'md' } | { size: 'icon' | 'icon-sm'; 'aria-label': string });
const BTN_VARIANT = {
  primary: 'glass-btn glass-btn-tint border-transparent',
  secondary: 'glass-btn border-transparent',
  ghost: 'border-transparent bg-transparent text-brand-700 hover:bg-slate-900/[0.06] disabled:text-slate-500',
  danger: 'glass-btn btn-danger border-transparent',
  success: 'glass-btn btn-success border-transparent',
} as const;
const BTN_SIZE = {
  md: 'min-h-control px-5 text-body',
  sm: 'min-h-control-sm px-4 text-sm',
  compact: 'min-h-control-sm px-4 text-sm',
  icon: 'h-control w-control shrink-0 !px-0',
  'icon-sm': 'h-control-sm w-control-sm shrink-0 !px-0',
} as const;
const BTN_BASE = cx('press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 font-bold', FOCUS_RING);
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  // Liquid Glass: the primary action is tinted glass, the others neutral capsules (docs/UI_GUIDE.md)
  return (
    <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx(BTN_BASE, 'disabled:cursor-not-allowed', variant !== 'primary' && 'disabled:opacity-60 aria-busy:opacity-100', BTN_SIZE[size], BTN_VARIANT[variant], className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

/** The Button look for an element that cannot be a <Button>/<LinkButton> (an external <a download>, a CSV link). */
export function buttonClass(variant: keyof typeof BTN_VARIANT = 'secondary', size: keyof typeof BTN_SIZE = 'md', className?: string) {
  return cx(BTN_BASE, BTN_SIZE[size], BTN_VARIANT[variant], className);
}

export function LinkButton({ href, children, variant = 'secondary', icon, className, size = 'md', target }: { href: string; children: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; icon?: React.ReactNode; className?: string; size?: 'sm' | 'compact' | 'md'; target?: '_blank' }) {
  return <Link href={href} target={target} rel={target ? 'noopener' : undefined} className={cx(BTN_BASE, BTN_SIZE[size], BTN_VARIANT[variant], className)}>{icon}{children}</Link>;
}

/**
 * A link-looking action inside text, a table row or a card header («Tarix», «Hammasi», «Tahrirlash»): brand text,
 * underline on hover, the focus ring, and an invisible ≥ 44px tall hit area. `href` → a Next link, else a button.
 */
type TextLinkProps = { children: React.ReactNode; className?: string; icon?: React.ReactNode; tone?: 'brand' | 'ink' | 'danger' | 'muted' } & (
  | { href: string; target?: '_blank' }
  | ({ href?: undefined } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>)
);
export function TextLink(props: TextLinkProps) {
  const { children, className, icon, tone = 'brand' } = props;
  const cls = cx('relative inline-flex items-center gap-1.5 rounded font-semibold underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60',
    'after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[""]', FOCUS_RING,
    tone === 'danger' ? 'text-red-700' : tone === 'muted' ? 'text-slate-700 hover:text-slate-900' : tone === 'ink' ? 'text-slate-900 hover:text-brand-700' : 'text-brand-700 hover:text-brand-800', className);
  if (props.href !== undefined) return <Link href={props.href} target={props.target} rel={props.target ? 'noopener' : undefined} className={cls}>{icon}{children}</Link>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { href: _h, children: _c, className: _cl, icon: _i, tone: _t, type = 'button', ...rest } = props;
  return <button type={type} className={cls} {...rest}>{icon}{children}</button>;
}

/** A whole list row as one button (a list with a detail pane: staff, items, news). `selected` = the accent bar + tint. */
export const RowButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }>(function RowButton({ selected, className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} aria-current={selected || undefined} data-no-press
    className={cx('flex min-h-control w-full items-center gap-3 px-5 py-3 text-left text-body text-slate-900', FOCUS_RING_INSET, selected ? 'bg-brand-50 shadow-selected' : 'hover:bg-slate-50', className)} {...rest} />;
});

/** A small uppercase heading inside a card («Shikoyatlar», «Tarix»). */
export function SectionTitle({ children, className, as: Tag = 'h3' }: { children: React.ReactNode; className?: string; as?: 'h2' | 'h3' | 'h4' | 'div' }) {
  return <Tag className={cx('text-small font-bold uppercase tracking-wide text-slate-600', className)}>{children}</Tag>;
}

/** A toggle chip (filter, topic, time slot): aria-pressed, solid accent when on. ≥ 44px tall. */
export const Chip = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }>(function Chip({ pressed, className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} aria-pressed={pressed}
    className={cx('press inline-flex min-h-control-sm items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-2 px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500', FOCUS_RING,
      pressed ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500', className)} {...rest} />;
});

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
      {error ? <p id={msgId} className="text-sm font-medium text-red-700" role="alert">{error}</p> : hint ? <p id={msgId} className="text-small text-slate-600">{hint}</p> : null}
    </div>
  );
}
/** An error line under a control that is not inside a Field (a checkbox group, a custom picker). */
export function FieldError({ children, id }: { children?: React.ReactNode; id?: string }) {
  return children ? <p id={id} role="alert" className="text-sm font-medium text-red-700">{children}</p> : null;
}
const W = (c?: string) => (c && /(^|\s)w-/.test(c) ? '' : 'w-full');
/** Fields are rounded rectangles (`rounded-field`); buttons and segments are capsules (docs/UI_GUIDE.md §0). */
const inputBase = 'rounded-field border-2 bg-white px-3 text-body text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-focus focus:border-brand-600 disabled:bg-slate-50 disabled:text-slate-600';
type FieldSize = 'md' | 'sm';
const FIELD_H: Record<FieldSize, string> = { md: 'h-control', sm: 'h-control-sm' };
// native date/time pickers follow the person's interface language where the browser supports it
const DATE_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week']);
export const Input = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { invalid?: boolean; size?: FieldSize }>(function Input({ className, invalid, size = 'md', ...p }, ref) {
  const f = useContext(FieldCtx);
  const { locale } = useI18n();
  return <input ref={ref} lang={p.type && DATE_TYPES.has(p.type) ? LOCALE_TAG[locale] : undefined} className={cx(inputBase, W(className), FIELD_H[size], invalid ? 'border-red-600' : 'border-slate-300', className)} aria-invalid={invalid || undefined} aria-describedby={f.describedBy} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...p }, ref) {
  const f = useContext(FieldCtx);
  return <textarea ref={ref} className={cx(inputBase, W(className), 'py-2.5 leading-relaxed', invalid ? 'border-red-600' : 'border-slate-300', className)} aria-invalid={invalid || undefined} aria-describedby={f.describedBy} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { invalid?: boolean; size?: FieldSize }>(function Select({ className, invalid, size = 'md', children, ...p }, ref) {
  const f = useContext(FieldCtx);
  return <select ref={ref} className={cx(inputBase, W(className), FIELD_H[size], 'pr-8', invalid ? 'border-red-600' : 'border-slate-300', className)} aria-invalid={invalid || undefined} aria-describedby={f.describedBy} {...p}>{children}</select>;
});

/**
 * Checkbox / Radio: a visible 1.25rem box and a ≥ 44px tall row that is tappable anywhere (the whole <label>).
 * Extra props go to the <input>; attributes for the row (data-*) go in `rowProps`.
 */
type CheckProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  label: React.ReactNode; hint?: React.ReactNode; rowClassName?: string; rowProps?: React.LabelHTMLAttributes<HTMLLabelElement> & { [k: `data-${string}`]: string | undefined };
};
function makeCheck(type: 'checkbox' | 'radio') {
  const C = forwardRef<HTMLInputElement, CheckProps>(function Check({ label, hint, rowClassName, rowProps, className, disabled, ...rest }, ref) {
    return (
      <label {...rowProps} className={cx('flex min-h-control-sm gap-3 py-1.5 text-body text-slate-900', hint ? 'items-start' : 'items-center', disabled ? 'cursor-not-allowed text-slate-600' : 'cursor-pointer', rowClassName)}>
        <input ref={ref} type={type} disabled={disabled} className={cx('h-5 w-5 shrink-0 accent-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed', hint ? 'mt-[0.15rem]' : '', !disabled && 'cursor-pointer', className)} {...rest} />
        <span className="min-w-0">{label}{hint && <span className="block text-small text-slate-600">{hint}</span>}</span>
      </label>
    );
  });
  return C;
}
export const Checkbox = makeCheck('checkbox');
export const Radio = makeCheck('radio');

// ---------- Badges ----------
const TONES = {
  gray: 'bg-slate-100 text-slate-800 ring-slate-200', blue: 'bg-sky-50 text-sky-800 ring-sky-200', teal: 'bg-brand-50 text-brand-800 ring-brand-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200', green: 'bg-emerald-50 text-emerald-800 ring-emerald-200', red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};
export type Tone = keyof typeof TONES;
export function Badge({ tone = 'gray', children, icon, className }: { tone?: Tone; children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-small font-semibold ring-1 ring-inset whitespace-nowrap', TONES[tone], className)}>{icon}{children}</span>;
}

// ---------- Card / page ----------
export function Card({ children, className, title, actions, padded = true }: { children: React.ReactNode; className?: string; title?: React.ReactNode; actions?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={cx('surface', className)}>
      {(title || actions) && <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-5 py-2"><h2 className="text-base font-bold text-slate-900">{title}</h2><div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div></header>}
      {/* padded={false}: the body hands the card's radius to its first/last child (a table's header row, a footer) */}
      <div className={padded ? 'p-5' : 'card-flush'}>{children}</div>
    </section>
  );
}
/** Page title (h1), one short line under it at most, and the page's primary action on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0"><h1 className="text-title font-bold tracking-tight text-slate-900">{title}</h1>{subtitle && <p className="mt-1 text-body text-slate-600">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A money amount for key numbers: the digits never split, the currency word is smaller (and may move under on a narrow card). */
export function Money({ tiyin, minus }: { tiyin: number; minus?: boolean }) {
  const num = formatSom(tiyin, false);
  const cur = formatSom(tiyin).slice(num.length).trim();
  return <span className="inline-flex flex-wrap items-baseline gap-x-1.5"><span className="whitespace-nowrap">{minus && tiyin ? '−' : ''}{num}</span><span className="whitespace-nowrap text-sm font-semibold text-slate-600">{cur}</span></span>;
}

/**
 * A key number. The label area is always two lines tall (a one-line label leaves the second empty), so the values of
 * tiles in one row line up; a longer label wraps — it is never cut. A link when `href` is given.
 */
export function StatCard({ icon, label, value, sub, href, loading, tone = 'default', className }: {
  icon?: React.ReactNode; label: string; value?: React.ReactNode; sub?: React.ReactNode; href?: string; loading?: boolean; tone?: 'default' | 'danger' | 'success'; className?: string;
}) {
  const body = (
    <div className={cx('surface flex h-full min-w-0 flex-col p-4 2xl:p-5', href && 'hover:!border-brand-300')}>
      <div className="flex min-h-[2.75em] items-start gap-2 text-sm font-semibold leading-snug text-slate-600">
        {icon && <span className={cx('mt-px shrink-0 [&>svg]:h-[1.125rem] [&>svg]:w-[1.125rem]', tone === 'danger' ? 'text-red-600' : tone === 'success' ? 'text-emerald-700' : 'text-brand-600')}>{icon}</span>}
        <span className="min-w-0 hyphens-auto break-words">{label}</span>
      </div>
      {loading ? <Skeleton className="mt-2 h-7 w-28" /> : <div className={cx('mt-2 text-stat font-bold leading-none tabular-nums tracking-tight 2xl:text-2xl', tone === 'danger' ? 'text-red-700' : tone === 'success' ? 'text-emerald-800' : 'text-slate-900')}>{value}</div>}
      {loading ? <Skeleton className="mt-2 h-3 w-32" /> : sub != null && <div className="mt-2 break-words text-small leading-snug text-slate-600">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className={cx('block rounded-surface', FOCUS_RING, className)}>{body}</Link> : <div className={className}>{body}</div>;
}

/** Filter bar at the top of a card: filters on the left, secondary actions (export…) on the right, one row when it fits. */
export function Toolbar({ children, actions, className }: { children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-5 py-3 first:rounded-t-[inherit]', className)}>
      <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-2 sm:basis-0">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- States ----------
export function Skeleton({ className }: { className?: string }) { return <div className={cx('rounded bg-slate-200/70 motion-safe:animate-pulse', className)} />; }
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
  return <div className={cx('flex gap-3 rounded-field border px-4 py-3 text-sm', s)} role={tone === 'red' ? 'alert' : undefined}><Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><div className="min-w-0">{title && <p className="font-semibold">{title}</p>}{children}</div></div>;
}

// ---------- Table ----------
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  // focusable, so a wide table can be scrolled sideways with the keyboard; inside Card padded={false} it takes the
  // card's corner radius (globals.css .card-flush) and clips its grey header row to it
  return <div tabIndex={0} className={cx('overflow-x-auto', FOCUS_RING_INSET, className)}><table className="w-full text-left text-sm">{children}</table></div>;
}
// the first and last columns start where the card title and toolbar start (px-5), the others keep px-3
const EDGE = 'px-3 first:pl-5 last:pr-5';
export function Th({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <th scope="col" className={cx('sticky top-0 border-b border-slate-200 bg-slate-50 py-2.5 text-small font-semibold text-slate-600 whitespace-nowrap', EDGE, right && 'text-right', className)}>{children}</th>;
}
export function Td({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <td className={cx('border-b border-slate-100 py-2.5 align-middle', EDGE, right && 'text-right tabular-nums whitespace-nowrap', className)}>{children}</td>;
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 py-1 pl-5 pr-3 text-sm text-slate-700">
      <span>{t('common.found', { n: total })}</span>
      <div className="flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('common.prevPage')}><ChevronLeft className="h-5 w-5" /></Button>
        <span className="tabular-nums">{page} / {pages}</span>
        <Button size="icon-sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('common.nextPage')}><ChevronRight className="h-5 w-5" /></Button>
      </div>
    </div>
  );
}

// ---------- Sliding pill ----------
/**
 * The raised capsule of a segmented control / tab bar. It is one element that slides (on the spring) to whatever
 * child of `container` carries `data-active="true"`; the items themselves only change their text colour.
 * The container is `relative`; the pill sits under the items (z-0), so give the items `relative z-raised`.
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

/** Arrow keys / Home / End move the choice of a radio group or tab strip and the focus with it (roving tabindex). */
function onArrowKeys<T>(e: React.KeyboardEvent<HTMLElement>, options: { value: T; disabled?: boolean }[], value: T, onChange: (v: T) => void) {
  const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  if (!enabled.length || (!step && e.key !== 'Home' && e.key !== 'End')) return;
  const pos = enabled.indexOf(options.findIndex((o) => o.value === value));
  const next = e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled[enabled.length - 1] : enabled[pos < 0 ? 0 : (pos + step + enabled.length) % enabled.length];
  e.preventDefault();
  onChange(options[next].value);
  const strip = e.currentTarget;
  requestAnimationFrame(() => strip.querySelectorAll<HTMLElement>(':scope > button')[next]?.focus());
}

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; icon?: React.ReactNode; disabled?: boolean; title?: string; ariaLabel?: string; lang?: string; id?: string; controls?: string };
/**
 * One choice out of 2–5 short options (period, view, language, sign-in method): a capsule strip with the sliding pill.
 * `md` = the control height (sits in a row with Input/Button md), `compact` = 2.5rem. `variant="glass"` on the shell's
 * glass, `plain` (grey strip, white pill) on cards. `role="tablist"` when it switches what is shown below it.
 */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md', variant = 'plain', role = 'radiogroup', stretch, className, testId }: {
  value: T; onChange: (v: T) => void; options: SegmentedOption<T>[]; label: string; size?: 'md' | 'compact'; variant?: 'plain' | 'glass'; role?: 'radiogroup' | 'tablist'; stretch?: boolean; className?: string; testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tab = role === 'tablist';
  const focusable = options.some((o) => o.value === value) ? value : options.find((o) => !o.disabled)?.value;
  return (
    <div ref={box} role={role} aria-label={label} data-testid={testId} onKeyDown={(e) => onArrowKeys(e, options, value, onChange)}
      className={cx('relative max-w-full shrink-0 items-center gap-0.5 rounded-full p-0.5', stretch ? 'flex w-full' : 'inline-flex', size === 'md' ? 'h-control' : 'h-control-sm',
        variant === 'glass' ? 'glass-field' : 'bg-slate-100 ring-1 ring-inset ring-slate-200/80', className)}>
      <SlidingPill container={box} active={value} className={cx('rounded-full', variant === 'glass' ? 'glass-on' : 'bg-white shadow-pill')} />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role={tab ? 'tab' : 'radio'} aria-checked={tab ? undefined : on} aria-selected={tab ? on : undefined}
            data-active={on} data-value={o.value} tabIndex={o.value === focusable ? 0 : -1} disabled={o.disabled} title={o.title} aria-label={o.ariaLabel} lang={o.lang} id={o.id} aria-controls={o.controls}
            onClick={() => { if (!on) onChange(o.value); }}
            className={cx('press relative z-raised inline-flex h-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[""] disabled:cursor-not-allowed disabled:opacity-50',
              FOCUS_RING_INSET, size === 'md' ? 'px-4 text-body' : 'px-3 text-sm', stretch && 'flex-1', on ? 'text-brand-800' : 'text-slate-700 hover:bg-white/50 hover:text-slate-900')}>
            {o.icon}{o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Tabs ----------
/** Tabs above a card's content. Scrolls sideways when it does not fit; a fade on an edge says there is more. */
export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number }[]; label?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ l: false, r: false });
  useEffect(() => {
    const strip = list.current; if (!strip) return;
    const measure = () => {
      const l = strip.scrollLeft > 2, r = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2;
      setFade((f) => (f.l === l && f.r === r ? f : { l, r }));
    };
    measure(); strip.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure); ro.observe(strip);
    return () => { strip.removeEventListener('scroll', measure); ro.disconnect(); };
  }, [items.length]);
  // a selected tab outside the visible strip (narrow card, link to ?status=…) is scrolled into view, clear of the fade.
  // Only the strip scrolls (sideways): scrollIntoView would also move the page under the floating bars on a phone.
  // The strip is `relative`, so it is the tab's offsetParent: offsetLeft is already measured from the strip's edge.
  useEffect(() => {
    const strip = list.current, el = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !el || strip.scrollWidth <= strip.clientWidth) return;
    const pad = 40, left = el.offsetLeft, right = left + el.offsetWidth;
    if (left - pad < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - pad);
    else if (right + pad > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right + pad - strip.clientWidth;
  }, [value]);
  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={(e) => onArrowKeys(e, items, value, onChange)}
      className={cx('relative flex h-control max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-full bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200/80 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', fade.l && 'fade-l', fade.r && 'fade-r')}>
      <SlidingPill container={list} active={value} className="rounded-full bg-white shadow-pill" />
      {items.map((it) => {
        const on = value === it.value;
        return (
          <button key={it.value} type="button" role="tab" aria-selected={on} data-active={on} tabIndex={on ? 0 : -1} onClick={() => onChange(it.value)}
            className={cx('press relative z-raised inline-flex h-full shrink-0 items-center whitespace-nowrap rounded-full px-4 text-body font-semibold', FOCUS_RING_INSET, on ? 'text-brand-800' : 'text-slate-700 hover:text-slate-900')}>
            {it.label}{it.count != null && <span className="ml-2 rounded-full bg-slate-200 px-2 text-xs font-bold text-slate-800">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Modal ----------
/** The modal's guarded close: asks first when the dialog holds typed data (`dirty`), exactly like Esc, X and the backdrop. */
const ModalCloseCtx = createContext<() => void>(() => undefined);
export function useModalClose() { return useContext(ModalCloseCtx); }
/** Footer «Bekor qilish»/«Ortga»: closes through the modal's guarded close, so typed input is never dropped without asking. */
export function ModalCancel({ children, ...rest }: Omit<BtnBase, 'onClick'> & { size?: 'sm' | 'compact' | 'md' }) {
  const t = useT();
  const close = useModalClose();
  return <Button {...rest} data-cancel onClick={close}>{children ?? t('common.cancel')}</Button>;
}
const TEXT_CONTROL = 'textarea:not([disabled]):not([readonly]),input:not([disabled]):not([readonly]):not([type=checkbox]):not([type=radio]):not([type=hidden]),select:not([disabled])';
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
    // first focus: an explicit [data-autofocus], else the first field of the body, else its first control, else the
    // footer's primary action, else the dialog itself — never «Bekor qilish» and never the close X
    setTimeout(() => {
      const p = panel.current; if (!p) return;
      const body = p.querySelector<HTMLElement>('[data-modal-body]'), foot = p.querySelector<HTMLElement>('[data-modal-footer]');
      const el = p.querySelector<HTMLElement>('[autofocus],[data-autofocus]')
        ?? body?.querySelector<HTMLElement>(TEXT_CONTROL)
        ?? body?.querySelector<HTMLElement>('input:not([disabled]):not([type=hidden]),button:not([disabled]),a[href]')
        ?? foot?.querySelector<HTMLElement>('.glass-btn-tint:not([disabled])')
        ?? p;
      el.focus();
    }, 30);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, tryClose]);
  if (!open || typeof document === 'undefined') return null;
  // rendered at the end of <body>: never inherits table/space-y styles of the place that opened it
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-modal flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 pt-[4vh] backdrop-blur-sm print:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx('modal-panel flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-panel border border-white bg-white text-left shadow-modal focus:outline-none', width)}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 py-2 pl-5 pr-2">
          <h2 id={titleId} className="min-w-0 py-1 text-lg font-bold text-slate-900">{title}</h2>
          <Button variant="ghost" size="icon" data-close onClick={tryClose} className="!text-slate-600 hover:!text-slate-900" aria-label={t('common.close')}><X className="h-5 w-5" /></Button>
        </div>
        {confirming && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
            <span>{t('state.unsavedClose')}</span>
            <div className="flex gap-2"><Button size="sm" data-confirm-stay onClick={() => setConfirming(false)}>{t('common.stay')}</Button><Button size="sm" variant="danger" onClick={onClose}>{t('common.close')}</Button></div>
          </div>
        )}
        <ModalCloseCtx.Provider value={tryClose}>
          <div data-modal-body className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {/* on a phone the buttons share the row's width instead of wrapping onto two rows */}
          {footer && <div data-modal-footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-b-panel border-t border-slate-100 bg-slate-50/70 px-5 py-3 [&>*]:flex-1 sm:[&>*]:flex-none">{footer}</div>}
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
      {/* below lg the phone tab bar sits at the bottom: toasts stay above it (and above the home indicator) */}
      <div className="pointer-events-none fixed bottom-[calc(var(--tabbar)+0.5rem)] right-4 z-toast flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 print:hidden lg:bottom-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} aria-live={t.tone === 'error' ? 'assertive' : undefined} className={cx('toast-in pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-body font-medium shadow-popover', t.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : t.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-sky-200 bg-sky-50 text-sky-900')}>
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
