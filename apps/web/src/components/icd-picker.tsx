'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { Alert, Badge, Button, cx, Input } from '@/components/ui';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@meduza/contracts';

export type Icd = { code: string; title: string };
type Row = { code: string; title_ru: string; title_uz: string | null };
type Suggestion = { code: string; title: string; title_ru: string; confidence: 'high' | 'medium' | 'low' | null; reason: string | null };

/**
 * MKB-10 codes for the note: search the clinic's code table, or ask for suggestions from the diagnosis text
 * (AI over the same table when live, word matching otherwise). The doctor always chooses; nothing is added automatically.
 */
export function IcdPicker({ value, onChange, diagnosis, encounterId, disabled }: { value: Icd[]; onChange: (v: Icd[]) => void; diagnosis: string; encounterId: string; disabled?: boolean }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q.trim(), 250);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [active, setActive] = useState(-1); // keyboard-highlighted option
  const search = useQuery({ queryKey: ['icd10', debounced], queryFn: () => api<{ data: Row[] }>(`/icd10?q=${encodeURIComponent(debounced)}`).then((r) => r.data), enabled: debounced.length >= 2 });
  const suggest = useMutation({ mutationFn: () => api<{ data: { mode: 'live' | 'search'; suggestions: Suggestion[] } }>('/ai/icd10-suggest', { method: 'POST', body: { text: diagnosis, encounter_id: encounterId } }).then((r) => r.data) });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const has = (code: string) => value.some((x) => x.code === code);
  const add = (code: string, title: string) => { if (!has(code) && value.length < 5) onChange([...value, { code, title }]); setQ(''); setOpen(false); setActive(-1); };
  const rows = open && debounced.length >= 2 ? search.data ?? [] : [];
  // combobox keys: ↓/↑ move through the list, Enter adds, Esc closes only the list (not the dialog around it)
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault(); setOpen(true);
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % rows.length : (i <= 0 ? rows.length - 1 : i - 1)));
    } else if (e.key === 'Enter' && active >= 0 && rows[active]) {
      e.preventDefault(); if (!has(rows[active].code)) add(rows[active].code, rows[active].title_uz ?? rows[active].title_ru);
    } else if (e.key === 'Escape' && open && debounced.length >= 2) {
      e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setOpen(false); setActive(-1);
    }
  }
  const needText = diagnosis.trim().length < 3;

  return (
    <div className="space-y-2" ref={box}>
      <label htmlFor={`${listId}-q`} className="block text-sm font-semibold text-slate-800">{t('icd.label')}</label>
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {value.map((x) => (
            <span key={x.code} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-1 text-sm text-brand-900">
              <b className="tabular-nums">{x.code}</b><span className="max-w-[17rem] truncate">{x.title}</span>
              {!disabled && <button type="button" aria-label={t('icd.remove', { code: x.code })} className="rounded-full p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" onClick={() => onChange(value.filter((v) => v.code !== x.code))}><X className="h-4 w-4" /></button>}
            </span>
          ))}
        </div>
      )}
      {disabled && !value.length && <p className="text-sm text-slate-600">{t('icd.none')}</p>}
      {!disabled && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="relative min-w-[13rem] flex-1">
            <Input id={`${listId}-q`} aria-label={t('icd.search')} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
              role="combobox" aria-expanded={open && debounced.length >= 2} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              placeholder={t('icd.placeholder')} />
            {open && debounced.length >= 2 && (
              <ul role="listbox" id={listId} className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
                {search.isLoading && <li className="px-3 py-2 text-slate-600">{t('common.searching')}</li>}
                {search.data?.length === 0 && <li className="px-3 py-2 text-slate-600">{t('common.notFound')}</li>}
                {search.data?.map((r, i) => (
                  <li key={r.code}>
                    <button type="button" role="option" id={`${listId}-${i}`} tabIndex={-1} aria-selected={i === active} disabled={has(r.code)} onClick={() => add(r.code, r.title_uz ?? r.title_ru)}
                      onMouseEnter={() => setActive(i)} ref={(el) => { if (i === active) el?.scrollIntoView({ block: 'nearest' }); }}
                      className={cx('flex min-h-10 w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-60', i === active && 'bg-brand-50')}>
                      <b className="w-14 shrink-0 tabular-nums text-brand-800">{r.code}</b><span>{r.title_uz ?? r.title_ru}<span className="block text-[0.8125rem] text-slate-600" lang="ru">{r.title_ru}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button icon={<Sparkles className="h-4 w-4 text-brand-600" />} loading={suggest.isPending} disabled={needText}
            title={needText ? t('icd.suggestNeedText') : t('icd.suggestTitle')} aria-describedby={needText ? `${listId}-need` : undefined} onClick={() => suggest.mutate()}>{t('icd.suggest')}</Button>
        </div>
      )}
      {/* why «Kod taklif qilish» is grey: said in words, not only in a tooltip */}
      {!disabled && needText && <p id={`${listId}-need`} className="text-[0.8125rem] text-slate-600">{t('icd.suggestNeedText')}</p>}
      {suggest.isError && <Alert tone="red">{t('icd.suggestFailed', { msg: (suggest.error as Error).message })}</Alert>}
      {suggest.data && !disabled && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-slate-700">
            {suggest.data.mode === 'live' ? <Badge tone="teal">{t('icd.aiSuggestion')}</Badge> : <Badge>{t('icd.wordMatch')}</Badge>}
            <span>{t('icd.onlyClinic')}</span>
          </div>
          {!suggest.data.suggestions.length ? <p className="text-sm text-slate-600">{t('icd.noMatch')}</p> : (
            <ul className="space-y-1">
              {suggest.data.suggestions.map((s) => (
                <li key={s.code} className="flex items-start gap-2 text-sm">
                  <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} disabled={has(s.code) || value.length >= 5} onClick={() => add(s.code, s.title)} aria-label={t('icd.add', { code: s.code })} />
                  <div className="pt-1.5"><b className="tabular-nums">{s.code}</b> {s.title}
                    {s.confidence && <span className={cx('ml-1.5 text-[0.8125rem] font-semibold', s.confidence === 'high' ? 'text-emerald-800' : s.confidence === 'medium' ? 'text-amber-800' : 'text-slate-600')}>({t(`icd.conf.${s.confidence}` as MessageKey)})</span>}
                    {s.reason && <span className="block text-[0.8125rem] text-slate-600">{s.reason}</span>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
