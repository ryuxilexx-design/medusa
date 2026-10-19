'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { Alert, Badge, Button, cx, Input } from '@/components/ui';

export type Icd = { code: string; title: string };
type Row = { code: string; title_ru: string; title_uz: string | null };
type Suggestion = { code: string; title: string; title_ru: string; confidence: 'high' | 'medium' | 'low' | null; reason: string | null };
const CONF: Record<string, string> = { high: 'aniq mos', medium: 'yaqin', low: 'taxminiy' };

/**
 * MKB-10 codes for the note: search the clinic's code table, or ask for suggestions from the diagnosis text
 * (AI over the same table when live, word matching otherwise). The doctor always chooses; nothing is added automatically.
 */
export function IcdPicker({ value, onChange, diagnosis, encounterId, disabled }: { value: Icd[]; onChange: (v: Icd[]) => void; diagnosis: string; encounterId: string; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q.trim(), 250);
  const box = useRef<HTMLDivElement>(null);
  const search = useQuery({ queryKey: ['icd10', debounced], queryFn: () => api<{ data: Row[] }>(`/icd10?q=${encodeURIComponent(debounced)}`).then((r) => r.data), enabled: debounced.length >= 2 });
  const suggest = useMutation({ mutationFn: () => api<{ data: { mode: 'live' | 'search'; suggestions: Suggestion[] } }>('/ai/icd10-suggest', { method: 'POST', body: { text: diagnosis, encounter_id: encounterId } }).then((r) => r.data) });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const has = (code: string) => value.some((x) => x.code === code);
  const add = (code: string, title: string) => { if (!has(code) && value.length < 5) onChange([...value, { code, title }]); setQ(''); setOpen(false); };

  return (
    <div className="space-y-2" ref={box}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-medium text-slate-700">MKB-10</span>
        {value.map((x) => (
          <span key={x.code} className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[13px] text-brand-900">
            <b className="tabular-nums">{x.code}</b><span className="max-w-[260px] truncate">{x.title}</span>
            {!disabled && <button type="button" aria-label={`${x.code} ni olib tashlash`} className="rounded p-0.5 text-brand-700 hover:bg-brand-100" onClick={() => onChange(value.filter((v) => v.code !== x.code))}><X className="h-3 w-3" /></button>}
          </span>
        ))}
        {!value.length && <span className="text-[13px] text-slate-400">kod tanlanmagan</span>}
      </div>
      {!disabled && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Input aria-label="MKB-10 qidirish" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Kod yoki nomi: I10, gastrit, bel og‘rig‘i…" className="h-8 text-[13px]" />
            {open && debounced.length >= 2 && (
              <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-[13px] shadow-lg">
                {search.isLoading && <li className="px-3 py-1.5 text-slate-500">Qidirilmoqda…</li>}
                {search.data?.length === 0 && <li className="px-3 py-1.5 text-slate-500">Topilmadi</li>}
                {search.data?.map((r) => (
                  <li key={r.code}>
                    <button type="button" role="option" aria-selected={has(r.code)} disabled={has(r.code)} onClick={() => add(r.code, r.title_uz ?? r.title_ru)}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50">
                      <b className="w-12 shrink-0 tabular-nums">{r.code}</b><span>{r.title_uz ?? r.title_ru}<span className="block text-xs text-slate-500">{r.title_ru}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={suggest.isPending} disabled={diagnosis.trim().length < 3}
            title={diagnosis.trim().length < 3 ? 'Avval tashxis matnini yozing' : 'Tashxis matni bo‘yicha kod taklif qilish'} onClick={() => suggest.mutate()}>Kod taklif qilish</Button>
        </div>
      )}
      {suggest.isError && <Alert tone="red">{(suggest.error as Error).message} Kodni qidiruv orqali tanlang.</Alert>}
      {suggest.data && !disabled && (
        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2">
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
            {suggest.data.mode === 'live' ? <Badge tone="teal">AI taklifi</Badge> : <Badge>So‘z bo‘yicha moslik (AI o‘chiq)</Badge>}
            <span>Faqat klinika ro‘yxatidagi kodlar. Tanlovni shifokor qiladi.</span>
          </div>
          {!suggest.data.suggestions.length ? <p className="text-[13px] text-slate-500">Mos kod topilmadi — qidiruvdan foydalaning.</p> : (
            <ul className="space-y-1">
              {suggest.data.suggestions.map((s) => (
                <li key={s.code} className="flex items-start gap-2 text-[13px]">
                  <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} disabled={has(s.code) || value.length >= 5} onClick={() => add(s.code, s.title)} aria-label={`${s.code} ni qo‘shish`} />
                  <div className="pt-1"><b className="tabular-nums">{s.code}</b> {s.title}
                    {s.confidence && <span className={cx('ml-1 text-xs', s.confidence === 'high' ? 'text-emerald-700' : s.confidence === 'medium' ? 'text-amber-700' : 'text-slate-500')}>· {CONF[s.confidence]}</span>}
                    {s.reason && <span className="block text-xs text-slate-500">{s.reason}</span>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
