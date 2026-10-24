'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { Badge, cx, Input } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export type Drug = { id: string; inn: string; inn_ru: string; atc: string | null; forms: string[]; allergy_classes: string[]; prescription_only: boolean };

/** The drug's name in the doctor's language: Russian МНН for a Russian interface, the international INN otherwise (data, never transliterated). */
export const drugName = (d: Pick<Drug, 'inn' | 'inn_ru'>, locale: string) => (locale === 'ru' ? d.inn_ru : d.inn);

/**
 * Drug name field with the reference list (GET /drugs): typing searches INN / Russian name / ATC; picking fills the name
 * and keeps the drug's id (allergy and duplicate checks). Typing over a picked name turns it back into free text.
 */
export function DrugCombobox({ value, drugId, onText, onPick, invalid, ariaLabel, placeholder }: {
  value: string; drugId: string | null; onText: (v: string) => void; onPick: (d: Drug) => void; invalid?: boolean; ariaLabel: string; placeholder?: string;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const q = useDebounced(value.trim(), 250);
  const show = open && !drugId && q.length >= 2;
  const search = useQuery({ queryKey: ['drugs', q], queryFn: () => api<{ data: Drug[] }>(`/drugs?q=${encodeURIComponent(q)}`).then((r) => r.data), enabled: show, staleTime: 60_000 });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const rows = show ? search.data ?? [] : [];
  const pick = (d: Drug) => { onPick(d); setOpen(false); setActive(-1); };
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.length) {
      e.preventDefault(); setOpen(true);
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % rows.length : i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0 && rows[active]) {
      e.preventDefault(); pick(rows[active]);
    } else if (e.key === 'Escape' && show) {
      // Esc closes only the list, not the dialog around it
      e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setOpen(false); setActive(-1);
    }
  }
  return (
    <div className="relative" ref={box}>
      <Input aria-label={ariaLabel} size="sm" className={cx('text-sm', drugId && 'border-brand-300 bg-brand-50/40')} value={value} invalid={invalid} placeholder={placeholder}
        onChange={(e) => { onText(e.target.value); setOpen(true); setActive(-1); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off" />
      {show && (
        <ul role="listbox" id={listId} className="absolute left-0 z-dropdown mt-1 max-h-72 w-[min(26rem,calc(100vw-3rem))] overflow-y-auto rounded-field border border-slate-200 bg-white py-1 text-sm shadow-popover">
          {search.isLoading && <li className="px-3 py-2 text-slate-600">{t('common.searching')}</li>}
          {search.data?.length === 0 && <li className="px-3 py-2 text-slate-600">{t('rx.notInList')}</li>}
          {rows.map((d, i) => (
            <li key={d.id}>
              <button type="button" role="option" id={`${listId}-${i}`} tabIndex={-1} aria-selected={i === active} onClick={() => pick(d)} onMouseEnter={() => setActive(i)}
                ref={(el) => { if (i === active) el?.scrollIntoView({ block: 'nearest' }); }}
                className={cx('flex min-h-control w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-50', i === active && 'bg-brand-50')}>
                <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
                  <b className="text-slate-900">{drugName(d, locale)}</b>
                  {d.atc && <span className="text-small tabular-nums text-slate-600">{d.atc}</span>}
                  {d.prescription_only && <Badge tone="blue" className="ml-auto">{t('rx.rxOnly')}</Badge>}
                </span>
                <span className="text-small text-slate-600">
                  {locale === 'ru' ? d.inn : d.inn_ru}{d.forms.length > 0 && ` · ${d.forms.map((f) => t(`drugForm.${f}` as MessageKey)).join(', ')}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
