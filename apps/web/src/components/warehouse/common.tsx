'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, FileEdit, Lock, XCircle } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Badge, cx, Input, type Tone } from '@/components/ui';

/** Quantities: grouped digits, decimals only when there are any («12», «2,5»). */
/** A quantity; `null` = hidden while a blind count of the item is open. */
export const qty = (v: unknown) => v === null ? '—' : Number(v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/ /g, ' ');
/** Parses a typed quantity («2,5» or «2.5»); NaN when it is not a number. */
export const parseQty = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/\s/g, '').replace(',', '.')));

export type CatalogItem = { id: string; name: string; unit: string; category: string; controlled: boolean; available: string };
/** Active items of a branch with the usable (not expired) quantity — what a requester may pick. */
export function useCatalog(branchId: string | undefined) {
  return useQuery({ queryKey: ['warehouse', 'catalog', branchId], enabled: !!branchId,
    queryFn: () => api(`/warehouse/catalog?branch_id=${branchId}`).then((r) => r.data as CatalogItem[]) });
}

const STATUS: Record<string, { tone: Tone; icon: React.ReactNode }> = {
  draft: { tone: 'gray', icon: <FileEdit className="h-3.5 w-3.5" /> },
  submitted: { tone: 'yellow', icon: <Clock className="h-3.5 w-3.5" /> },
  partially_issued: { tone: 'blue', icon: <Clock className="h-3.5 w-3.5" /> },
  issued: { tone: 'green', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  rejected: { tone: 'red', icon: <XCircle className="h-3.5 w-3.5" /> },
  cancelled: { tone: 'gray', icon: <XCircle className="h-3.5 w-3.5" /> },
  pending: { tone: 'yellow', icon: <Clock className="h-3.5 w-3.5" /> },
  approved: { tone: 'green', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  open: { tone: 'yellow', icon: <Clock className="h-3.5 w-3.5" /> },
};
/** A document state: word + icon + colour (never colour alone). */
export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const s = STATUS[status] ?? STATUS.draft;
  return <Badge tone={s.tone} icon={s.icon}>{t(`wh.status.${status}` as MessageKey)}</Badge>;
}
export function ControlledBadge() {
  const t = useT();
  return <Badge tone="violet" icon={<Lock className="h-3.5 w-3.5" />}>{t('wh.controlled')}</Badge>;
}
/** Expiry date with a red «expired» / amber «soon» mark. */
export function Expiry({ date, today }: { date: string | null; today: string }) {
  const t = useT();
  if (!date) return <span className="text-slate-600">—</span>;
  const d = String(date).slice(0, 10);
  const days = Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  if (days < 0) return <span className="inline-flex items-center gap-1 font-semibold text-red-700"><AlertTriangle className="h-4 w-4" />{fmtDate(d)} · {t('wh.expired')}</span>;
  if (days <= 90) return <span className="font-semibold text-amber-800">{fmtDate(d)} · {t('wh.daysLeft', { n: days })}</span>;
  return <span>{fmtDate(d)}</span>;
}
/** What the items were for, in one short line (patient name/number, procedure or department). */
export function PurposeText({ r }: { r: any }) {
  const t = useT();
  if (r.purpose === 'department') return <span>{t('wh.purpose.department')}: {r.department}</span>;
  const who = r.last_name ? `${r.last_name} ${r.first_name} #${r.patient_number}` : '';
  return <span>{r.purpose === 'procedure' ? `${r.order_service ?? t('wh.purpose.procedure')} · ` : ''}{who}{r.icd_codes?.length ? ` · ${r.icd_codes.join(', ')}` : ''}</span>;
}
export const CATEGORIES = ['medicine', 'consumable', 'reagent', 'instrument', 'other'] as const;
export const STORAGE = ['room', 'fridge', 'freezer'] as const;

/** Low stock: the usable (not expired) quantity is under the minimum — an expired lot never hides a shortage. */
export const isLow = (i: { active: boolean; usable_qty?: unknown; qty: unknown; minimum_qty: unknown }) => i.active && i.qty !== null && Number(i.usable_qty ?? i.qty) < Number(i.minimum_qty);

export type PickOption = { id: string; label: string; sub?: string; disabled?: boolean };
/**
 * A searchable picker (combobox): typing filters the options by name (and the grey second line, e.g. a series),
 * arrows + Enter pick, Esc closes only the list. The chosen option's name stays in the field; typing over it clears the
 * choice until another option is picked. Long catalogues stay usable (no endless <select>).
 */
export function ItemPicker({ options, value, onChange, ariaLabel, id, invalid, placeholder, loading, disabled, size = 'md' }: {
  options: PickOption[]; value: string; onChange: (id: string) => void; ariaLabel: string; id?: string; invalid?: boolean; placeholder?: string; loading?: boolean; disabled?: boolean; size?: 'md' | 'sm';
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setText(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const q = (text ?? '').trim().toLowerCase();
  const rows = open ? options.filter((o) => !q || o.label.toLowerCase().includes(q) || (o.sub ?? '').toLowerCase().includes(q)).slice(0, 60) : [];
  const pick = (o: PickOption) => { if (o.disabled) return; onChange(o.id); setText(null); setOpen(false); setActive(-1); };
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (rows.length || !open)) {
      e.preventDefault(); setOpen(true);
      if (rows.length) setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % rows.length : i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === 'Enter' && open && active >= 0 && rows[active]) {
      e.preventDefault(); pick(rows[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setOpen(false); setText(null); setActive(-1);
    }
  }
  return (
    <div className="relative min-w-0" ref={box}>
      <Input id={id} aria-label={id ? undefined : ariaLabel} size={size} disabled={disabled} value={text ?? selected?.label ?? ''} invalid={invalid} placeholder={loading ? t('common.loading') : placeholder ?? t('wh.pick.search')}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); if (value) onChange(''); }} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKey}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off" />
      {open && !disabled && (
        <ul role="listbox" id={listId} aria-label={ariaLabel} className="absolute left-0 right-0 z-dropdown mt-1 max-h-72 overflow-y-auto rounded-field border border-slate-200 bg-white py-1 text-sm shadow-popover">
          {!rows.length && <li className="px-3 py-2 text-slate-600">{loading ? t('common.loading') : t('wh.pick.none')}</li>}
          {rows.map((o, i) => (
            <li key={o.id}>
              <button type="button" role="option" id={`${listId}-${i}`} tabIndex={-1} aria-selected={o.id === value} aria-disabled={o.disabled || undefined} data-no-press
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
                ref={(el) => { if (i === active) el?.scrollIntoView({ block: 'nearest' }); }}
                className={cx('flex min-h-control-sm w-full flex-col items-start justify-center px-3 py-1.5 text-left', o.disabled ? 'cursor-not-allowed text-slate-500' : 'hover:bg-slate-50', i === active && !o.disabled && 'bg-brand-50')}>
                <span className="font-semibold text-slate-900">{o.label}</span>
                {o.sub && <span className="text-small text-slate-600">{o.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
