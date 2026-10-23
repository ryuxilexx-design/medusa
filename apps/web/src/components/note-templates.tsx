'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, EyeOff, LayoutTemplate, Plus, X } from 'lucide-react';
import { NOTE_TEXT_FIELDS, type MessageKey, type NoteTextField } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, cx, Field, Input, LoadingRows, Modal, ModalCancel, Select, useToast } from '@/components/ui';
import { applyFields, type Choice, FieldApplyList } from '@/components/apply-fields';
import type { Icd } from '@/components/icd-picker';

export type NoteTemplate = {
  id: string; specialty: string | null; name: string; fields: Partial<Record<NoteTextField, string | null>>; icd: Icd[];
  order_services: { id: string; name: string; category: string }[]; starter: boolean; mine: boolean; author_name: string | null;
};
export type TemplateApply = { fields: Partial<Record<NoteTextField, string>>; icd10: Icd[] };
type FieldDef = { key: NoteTextField; label: string };
const FIELD_LABEL: Record<NoteTextField, MessageKey> = { complaints: 'note.complaints', anamnesis: 'note.anamnesis', examination: 'note.examination', diagnosis: 'note.diagnosis', recommendations: 'note.recommendations' };
export const useFieldDefs = (): FieldDef[] => { const t = useT(); return NOTE_TEXT_FIELDS.map((key) => ({ key, label: t(FIELD_LABEL[key]) })); };

/**
 * «Shablon»: pick a template (search, own specialty first), see what it does to each field (empty → filled; typed →
 * keep/replace/append), the ICD codes it adds and the orders it proposes — the doctor ticks the orders they want.
 * Nothing is saved or ordered without the doctor: the note stays a draft, the orders go through the normal endpoint.
 */
export function TemplateModal({ open, onClose, encounterId, current, existingOrders, onApply }: {
  open: boolean; onClose: () => void; encounterId: string; current: Record<NoteTextField, string> & { icd10: Icd[] };
  existingOrders: { service_name: string; status: string }[]; onApply: (d: TemplateApply) => void;
}) {
  const t = useT();
  const { me } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const fields = useFieldDefs();
  const list = useQuery({ queryKey: ['note-templates'], queryFn: () => api<{ data: NoteTemplate[]; meta: { specialty: string | null } }>('/note-templates'), enabled: open });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<NoteTemplate | null>(null);
  const [choice, setChoice] = useState<Partial<Record<NoteTextField, Choice>>>({});
  const [orders, setOrders] = useState<string[]>([]);
  useEffect(() => { if (open) { setQ(''); setPicked(null); setChoice({}); setOrders([]); } }, [open]);

  const mySpecialty = list.data?.meta.specialty ?? me.doctor_specialty;
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = (list.data?.data ?? []).filter((x) => !needle || x.name.toLowerCase().includes(needle) || (x.specialty ?? '').toLowerCase().includes(needle));
    return [
      { key: 'mine', label: t('tpl.mine'), items: all.filter((x) => x.specialty && x.specialty === mySpecialty) },
      { key: 'all', label: t('tpl.all'), items: all.filter((x) => !x.specialty) },
      { key: 'other', label: t('tpl.other'), items: all.filter((x) => x.specialty && x.specialty !== mySpecialty) },
    ].filter((g) => g.items.length);
  }, [list.data, q, mySpecialty, t]);

  const taken = new Set(existingOrders.filter((o) => o.status !== 'cancelled').map((o) => o.service_name));
  const draftOf = (k: NoteTextField) => picked?.fields[k] ?? '';
  const newIcd = picked ? picked.icd.filter((c) => !current.icd10.some((x) => x.code === c.code)).slice(0, Math.max(0, 5 - current.icd10.length)) : [];
  const icdSkipped = !!picked && picked.icd.some((c) => !current.icd10.some((x) => x.code === c.code)) && newIcd.length === 0;

  const order = useMutation({ mutationFn: (ids: string[]) => api(`/encounters/${encounterId}/orders`, { method: 'POST', body: { items: ids.map((id) => ({ service_id: id, quantity: 1 })) } }) });
  const hide = useMutation({
    mutationFn: (id: string) => api(`/note-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['note-templates'] }); toast.success(t('tpl.hidden')); setPicked(null); },
    onError: (e) => toast.error(e),
  });
  async function apply() {
    if (!picked) return;
    const out = applyFields(NOTE_TEXT_FIELDS, draftOf, current, choice);
    onApply({ fields: out, icd10: newIcd });
    onClose();
    if (!orders.length) { toast.info(t('tpl.applied')); return; }
    try {
      await order.mutateAsync(orders);
      ['encounter', 'invoices', 'orders'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(t('tpl.ordersDone', { n: orders.length }));
    } catch (e) {
      // the text is already in the form; only the orders failed — say so, the doctor orders them from «Tekshiruv buyurish»
      toast.error(t('tpl.ordersFailed', { msg: (e as Error).message }));
    }
  }

  const row = (x: NoteTemplate) => (
    <li key={x.id}>
      <button type="button" onClick={() => { setPicked(x); setChoice({}); setOrders([]); }}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold text-slate-900">{x.name}</span>
          <span className="block truncate text-[0.8125rem] text-slate-600">
            {[x.icd.map((c) => c.code).join(', '), x.order_services.length ? t('tpl.withOrders', { n: x.order_services.length }) : '', x.starter ? t('tpl.starter') : x.author_name ?? ''].filter(Boolean).join(' · ')}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
      </button>
    </li>
  );

  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title={<span className="flex items-center gap-2"><LayoutTemplate className="h-5 w-5 shrink-0 text-brand-600" />{picked ? picked.name : t('tpl.title')}</span>}
      footer={picked
        ? <><Button onClick={() => setPicked(null)}>{t('tpl.back')}</Button><Button variant="primary" data-testid="tpl-apply" onClick={apply}>{t('tpl.apply')}</Button></>
        : <ModalCancel />}>
      {!picked ? (
        <div className="space-y-3">
          <Input data-autofocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tpl.search')} aria-label={t('tpl.search')} />
          {list.isLoading ? <LoadingRows rows={5} /> : list.isError ? <Alert tone="red">{(list.error as Error).message}</Alert>
            : !list.data?.data.length ? <p className="rounded-lg border-2 border-dashed border-slate-300 p-6 text-center text-[0.9375rem] text-slate-600">{t('tpl.empty')}</p>
            : !groups.length ? <p className="p-6 text-center text-[0.9375rem] text-slate-600">{t('tpl.none')}</p>
            : groups.map((g) => (
              <section key={g.key}>
                <h3 className="mb-1 px-3 text-[0.8125rem] font-bold uppercase tracking-wide text-slate-600">{g.key === 'mine' ? `${g.label}: ${mySpecialty}` : g.label}</h3>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid={`tpl-group-${g.key}`}>{g.items.map(row)}</ul>
              </section>
            ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-slate-600">
            {picked.specialty ? <Badge>{picked.specialty}</Badge> : <Badge>{t('tpl.all')}</Badge>}
            {picked.starter && <Badge tone="blue">{t('tpl.starter')}</Badge>}
            {(picked.mine || me.role === 'manager') && <Button size="sm" variant="ghost" className="ml-auto" icon={<EyeOff className="h-4 w-4" />} loading={hide.isPending} onClick={() => hide.mutate(picked.id)}>{t('tpl.hide')}</Button>}
          </div>
          {NOTE_TEXT_FIELDS.some((k) => draftOf(k).trim()) ? (
            <FieldApplyList fields={fields} draftOf={draftOf} current={current} choice={choice} onChoice={(k, c) => setChoice((x) => ({ ...x, [k]: c }))} testIdPrefix="tpl-choice" />
          ) : <p className="text-[0.9375rem] text-slate-600">{t('tpl.noFields')}</p>}
          {newIcd.length > 0 && <Alert tone="blue">{t('tpl.icd', { codes: newIcd.map((c) => `${c.code} — ${c.title}`).join('; ') })}</Alert>}
          {icdSkipped && <Alert>{t('tpl.icdFull')}</Alert>}
          {picked.order_services.length > 0 && (
            <fieldset className="rounded-xl border border-slate-200 bg-slate-50/60 p-4" data-testid="tpl-orders">
              <legend className="px-1 text-sm font-bold text-slate-800">{t('tpl.orders')}</legend>
              <div className="space-y-1">
                {picked.order_services.map((s) => {
                  const dis = taken.has(s.name);
                  return (
                    <label key={s.id} className={cx('flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-[0.9375rem]', dis ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-white')}>
                      <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" disabled={dis} checked={orders.includes(s.id)} onChange={(e) => setOrders((x) => (e.target.checked ? [...x, s.id] : x.filter((i) => i !== s.id)))} />
                      <span className="min-w-0 flex-1">{s.name} <span className="text-[0.8125rem] text-slate-600">· {t(`service.${s.category}` as MessageKey)}{dis ? ` ${t('orders.taken')}` : ''}</span></span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-[0.8125rem] text-slate-600">{t('tpl.ordersHint')}</p>
            </fieldset>
          )}
        </div>
      )}
    </Modal>
  );
}

/** «Shablon sifatida saqlash»: the filled note (text + ICD codes, never the vitals, the dates or the patient) becomes a template. */
export function SaveTemplateModal({ open, onClose, current }: { open: boolean; onClose: () => void; current: Record<NoteTextField, string> & { icd10: Icd[] } }) {
  const t = useT();
  const { me } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState<string>('mine');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(''); setSpecialty(me.doctor_specialty ? 'mine' : 'all'); setErrors({}); setFormError(null); } }, [open, me.doctor_specialty]);
  const hasText = NOTE_TEXT_FIELDS.some((k) => current[k].trim());
  const save = useMutation({
    mutationFn: () => api('/note-templates', { method: 'POST', body: {
      name, specialty: specialty === 'mine' ? me.doctor_specialty : null,
      fields: Object.fromEntries(NOTE_TEXT_FIELDS.map((k) => [k, current[k].trim() || null])), icd_codes: current.icd10.map((x) => x.code),
    } }),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['note-templates'] }); toast.success(t('tpl.saved', { name: r.data.name })); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) { setErrors(e.fields); setFormError(e.fields.fields ?? null); } else setFormError((e as Error).message); },
  });
  return (
    <Modal open={open} onClose={onClose} dirty={!!name.trim() && !save.isPending} title={t('tpl.saveTitle')}
      footer={<><ModalCancel /><Button variant="primary" data-testid="tpl-save" loading={save.isPending} disabled={!name.trim() || !hasText} onClick={() => { setFormError(null); save.mutate(); }}>{t('tpl.saveDo')}</Button></>}>
      <div className="space-y-3">
        {formError && <Alert tone="red">{formError}</Alert>}
        {!hasText && <Alert>{t('tpl.saveEmpty')}</Alert>}
        <Field label={t('tpl.name')} required error={errors.name}>{(id) => <Input id={id} data-autofocus value={name} invalid={!!errors.name} placeholder={t('tpl.namePh')} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: '' })); }} />}</Field>
        <Field label={t('tpl.specialty')}>{(id) => (
          <Select id={id} value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
            {me.doctor_specialty && <option value="mine">{t('tpl.specialtyMine', { sp: me.doctor_specialty })}</option>}
            <option value="all">{t('tpl.all')}</option>
          </Select>
        )}</Field>
        <p className="text-[0.8125rem] text-slate-600">{t('tpl.saveHint')}</p>
      </div>
    </Modal>
  );
}

type Phrase = { id: string; field: NoteTextField; text: string; uses: number; shared: boolean };

/**
 * Chips under a note field: the doctor's most used lines first, one tap puts the line into the field. «Qo‘shish» saves
 * the selected text of the field (or its last line) as a new chip. Phrases are the doctor's own or the clinic's shared ones.
 */
export function QuickPhrases({ field, value, textarea, onInsert, disabled }: {
  field: NoteTextField; value: string; textarea: React.RefObject<HTMLTextAreaElement | null>; onInsert: (text: string) => void; disabled?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['quick-phrases', field], queryFn: () => api<{ data: Phrase[] }>(`/quick-phrases?field=${field}`).then((r) => r.data), staleTime: 60_000 });
  const [showAll, setShowAll] = useState(false);
  const pending = useRef(false);
  const add = useMutation({
    mutationFn: (text: string) => api<{ data: Phrase }>('/quick-phrases', { method: 'POST', body: { field, text } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quick-phrases', field] }); toast.success(t('phrase.saved')); },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/quick-phrases/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quick-phrases', field] }); toast.success(t('phrase.removed')); },
    onError: (e) => toast.error(e),
  });
  function saveCurrent() {
    const el = textarea.current;
    const sel = el && el.selectionStart !== el.selectionEnd ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
    const lastLine = value.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
    const text = (sel.trim() || lastLine).slice(0, 500);
    if (!text) { toast.info(t('phrase.nothing')); return; }
    add.mutate(text);
  }
  function use(p: Phrase) {
    onInsert(p.text);
    if (pending.current) return;
    pending.current = true;
    // the counter only orders the chips: a failed count is not worth a message
    api(`/quick-phrases/${p.id}/use`, { method: 'POST' }).catch(() => undefined).finally(() => { pending.current = false; qc.invalidateQueries({ queryKey: ['quick-phrases', field] }); });
  }
  const phrases = list.data ?? [];
  const shown = showAll ? phrases : phrases.slice(0, 6);
  if (disabled) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('phrase.label')} data-testid={`phrases-${field}`}>
      {shown.map((p) => (
        <span key={p.id} className="inline-flex max-w-full items-stretch overflow-hidden rounded-full border border-slate-300 bg-white text-sm text-slate-800">
          <button type="button" onClick={() => use(p)} title={p.text} className="min-h-9 max-w-[18rem] truncate px-3 hover:bg-brand-50 hover:text-brand-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">{p.text}</button>
          {!p.shared && <button type="button" aria-label={t('phrase.remove', { text: p.text })} onClick={() => remove.mutate(p.id)} className="border-l border-slate-200 px-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300"><X className="h-3.5 w-3.5" /></button>}
        </span>
      ))}
      {phrases.length > 6 && <button type="button" onClick={() => setShowAll((x) => !x)} className="min-h-9 rounded-full px-2 text-sm font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{showAll ? t('news.less') : `+${phrases.length - 6}`}</button>}
      <button type="button" onClick={saveCurrent} disabled={add.isPending} title={t('phrase.addTitle')}
        className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-slate-400 px-3 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:opacity-60">
        <Plus className="h-4 w-4" aria-hidden="true" />{t('phrase.add')}
      </button>
    </div>
  );
}
