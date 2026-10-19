'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FileText, Pill, Plus, Printer, Send, Trash2 } from 'lucide-react';
import { DOCUMENT_KIND_LABEL } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, cx, Field, Input, Modal, Textarea, useToast } from '@/components/ui';
import { IcdPicker, type Icd } from '@/components/icd-picker';

type Kind = 'referral' | 'certificate' | 'prescription';
type Doc = { id: string; kind: Kind; number: number; status: 'issued' | 'void'; issued_at: string; issued_by_name: string; void_reason: string | null };
type Note = { diagnosis: string; icd10: Icd[]; signed: boolean };
const SPECIALTIES = ['Kardiolog', 'Nevrolog', 'Endokrinolog', 'Gastroenterolog', 'Ginekolog', 'Urolog', 'LOR (otorinolaringolog)', 'Oftalmolog', 'Dermatolog', 'Travmatolog-ortoped', 'Jarroh', 'Pediatr', 'Psixiatr', 'Onkolog', 'UZI tekshiruvi', 'Rentgen', 'MSKT / MRT', 'Statsionar davolash'];
const PURPOSES = ['Ish joyiga taqdim etish uchun', 'O‘qish joyiga taqdim etish uchun', 'Talab qilingan joyga taqdim etish uchun'];
const ICON: Record<Kind, React.ReactNode> = { referral: <Send className="h-4 w-4" />, certificate: <FileText className="h-4 w-4" />, prescription: <Pill className="h-4 w-4" /> };

/** Documents issued from this visit: list, print, void; buttons to issue a referral, certificate or prescription. */
export function DocumentsCard({ encounterId, note }: { encounterId: string; note: Note }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<Kind | null>(null);
  const [voiding, setVoiding] = useState<Doc | null>(null);
  const [reason, setReason] = useState('');
  const docs = useQuery({ queryKey: ['documents', encounterId], queryFn: () => api<{ data: Doc[] }>(`/encounters/${encounterId}/documents`).then((r) => r.data) });
  const voidDoc = useMutation({
    mutationFn: () => api(`/documents/${voiding!.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success('Hujjat bekor qilindi'); setVoiding(null); setReason(''); qc.invalidateQueries({ queryKey: ['documents', encounterId] }); },
    onError: (e) => toast.error(e),
  });

  return (
    <Card title="Hujjatlar" actions={
      <div className="flex flex-wrap gap-1.5">
        {(['referral', 'certificate', 'prescription'] as Kind[]).map((k) => (
          <Button key={k} size="sm" icon={ICON[k]} onClick={() => setKind(k)}>{k === 'prescription' ? 'Retsept' : DOCUMENT_KIND_LABEL[k].replace('Tibbiy ', '')}</Button>
        ))}
      </div>}>
      {!docs.data?.length ? <p className="text-sm text-slate-500">Bu qabulda hujjat berilmagan. Hujjat qayddagi tashxis va MKB-10 bilan oldindan to‘ldiriladi.</p> : (
        <ul className="divide-y divide-slate-100">
          {docs.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className={cx('flex items-center gap-1.5 font-medium', d.status === 'void' && 'text-slate-400 line-through')}>{ICON[d.kind]}{DOCUMENT_KIND_LABEL[d.kind]} №{d.number}</span>
              <span className="text-xs text-slate-500">{fmtDateTime(d.issued_at)}</span>
              {d.status === 'void' ? <Badge>Bekor qilingan{d.void_reason ? `: ${d.void_reason}` : ''}</Badge> : <Badge tone="green">Berilgan</Badge>}
              <span className="ml-auto flex gap-1">
                <a href={`/print/document/${d.id}`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"><Printer className="h-3.5 w-3.5" />Chop etish</a>
                {d.status === 'issued' && <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => { setVoiding(d); setReason(''); }}>Bekor qilish</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {kind && <DocumentModal kind={kind} encounterId={encounterId} note={note} onClose={() => setKind(null)} />}
      <Modal open={!!voiding} onClose={() => setVoiding(null)} title={voiding ? `${DOCUMENT_KIND_LABEL[voiding.kind]} №${voiding.number} ni bekor qilish` : ''}
        footer={<><Button onClick={() => setVoiding(null)}>Ortga</Button><Button variant="danger" loading={voidDoc.isPending} disabled={reason.trim().length < 3} onClick={() => voidDoc.mutate()}>Bekor qilish</Button></>}>
        <p className="mb-2 text-sm text-slate-600">Berilgan hujjat o‘zgartirilmaydi. Xato bo‘lsa, bekor qilinadi (sababi saqlanadi) va yangisi beriladi. Bosma nusxada «Bekor qilingan» deb chiqadi.</p>
        <Field label="Sabab" required>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: doza noto‘g‘ri yozilgan" />}</Field>
      </Modal>
    </Card>
  );
}

type Item = { name: string; form: string; dose: string; frequency: string; duration: string; instructions: string };
const emptyItem = (): Item => ({ name: '', form: '', dose: '', frequency: '', duration: '', instructions: '' });

function DocumentModal({ kind, encounterId, note, onClose }: { kind: Kind; encounterId: string; note: Note; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [ref, setRef] = useState({ to_specialty: '', to_institution: '', reason: note.diagnosis, urgency: 'routine' as 'routine' | 'urgent', icd10: note.icd10, notes: '' });
  const [cert, setCert] = useState({ purpose: PURPOSES[0], include_diagnosis: false, rest_days: '0', notes: '' });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [rxNotes, setRxNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { setErrors({}); setFormError(null); }, [kind]);

  const body = () => kind === 'referral'
    ? { ...ref, to_institution: ref.to_institution || null, notes: ref.notes || null, icd10: ref.icd10.map((x) => x.code) }
    : kind === 'certificate'
      ? { purpose: cert.purpose, include_diagnosis: cert.include_diagnosis, rest_days: Number(cert.rest_days) || 0, notes: cert.notes || null }
      : { items: items.filter((i) => Object.values(i).some((v) => v.trim())).map((i) => ({ ...i, form: i.form || null, instructions: i.instructions || null })), notes: rxNotes || null };

  const issue = useMutation({
    mutationFn: () => api<{ data: { id: string; number: number } }>(`/encounters/${encounterId}/documents`, { method: 'POST', body: { kind, body: body() } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['documents', encounterId] });
      toast.success(`${DOCUMENT_KIND_LABEL[kind]} №${r.data.number} berildi`);
      onClose();
    },
    onError: (e) => {
      // field errors are shown next to the fields; the general message only when there is nothing more specific
      if (e instanceof ApiError && e.fields) { setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.replace(/^body\./, ''), v]))); setFormError(null); }
      else setFormError(e instanceof Error ? e.message : 'Saqlanmadi');
    },
  });
  const setItem = (i: number, k: keyof Item, v: string) => {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
    setErrors((e) => { const { items: _, [`items.${i}.${k}`]: __, ...rest } = e; return rest; });
  };

  return (
    <Modal open onClose={onClose} width={kind === 'prescription' ? 'max-w-5xl' : 'max-w-2xl'} title={`${DOCUMENT_KIND_LABEL[kind]} berish`}
      footer={<><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" loading={issue.isPending} onClick={() => { setFormError(null); issue.mutate(); }}>Berish va saqlash</Button></>}>
      <div className="space-y-3">
        {formError && <Alert tone="red">{formError}</Alert>}
        {kind === 'referral' && <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Kimga / qaysi tekshiruvga" required error={errors.to_specialty}>
              {(id) => <><Input id={id} list="ref-specialties" value={ref.to_specialty} onChange={(e) => setRef({ ...ref, to_specialty: e.target.value })} invalid={!!errors.to_specialty} placeholder="Masalan: Kardiolog" />
                <datalist id="ref-specialties">{SPECIALTIES.map((s) => <option key={s} value={s} />)}</datalist></>}
            </Field>
            <Field label="Muassasa (ixtiyoriy)" error={errors.to_institution}>{(id) => <Input id={id} value={ref.to_institution} onChange={(e) => setRef({ ...ref, to_institution: e.target.value })} placeholder="Masalan: shahar shifoxonasi" />}</Field>
          </div>
          <Field label="Yo‘llanma sababi" required error={errors.reason} hint="Qaydagi tashxisdan olindi — kerak bo‘lsa to‘ldiring">
            {(id) => <Textarea id={id} rows={3} value={ref.reason} onChange={(e) => setRef({ ...ref, reason: e.target.value })} invalid={!!errors.reason} />}
          </Field>
          <IcdPicker value={ref.icd10} diagnosis={ref.reason} encounterId={encounterId} onChange={(icd10) => setRef({ ...ref, icd10 })} />
          {errors.icd10 && <p className="text-xs text-red-600">{errors.icd10}</p>}
          <fieldset className="flex gap-4 text-sm"><legend className="sr-only">Shoshilinchlik</legend>
            {(['routine', 'urgent'] as const).map((u) => (
              <label key={u} className="flex items-center gap-1.5"><input type="radio" name="urgency" className="accent-brand-600" checked={ref.urgency === u} onChange={() => setRef({ ...ref, urgency: u })} />{u === 'routine' ? 'Rejali' : 'Shoshilinch'}</label>
            ))}
          </fieldset>
          <Field label="Izoh (ixtiyoriy)">{(id) => <Textarea id={id} rows={2} value={ref.notes} onChange={(e) => setRef({ ...ref, notes: e.target.value })} />}</Field>
        </>}

        {kind === 'certificate' && <>
          <Field label="Qayerga taqdim etiladi" required error={errors.purpose}>
            {(id) => <><Input id={id} list="cert-purposes" value={cert.purpose} onChange={(e) => setCert({ ...cert, purpose: e.target.value })} invalid={!!errors.purpose} />
              <datalist id="cert-purposes">{PURPOSES.map((s) => <option key={s} value={s} />)}</datalist></>}
          </Field>
          <label className={cx('flex items-start gap-2 text-sm', !note.signed && 'text-slate-400')}>
            <input type="checkbox" className="mt-0.5 accent-brand-600" checked={cert.include_diagnosis} disabled={!note.signed} onChange={(e) => setCert({ ...cert, include_diagnosis: e.target.checked })} />
            <span>Tashxisni yozish (faqat bemor so‘rasa)<span className="block text-xs text-slate-500">{note.signed ? 'Ma’lumotnoma klinikadan tashqariga chiqadi — tashxis sukut bo‘yicha yozilmaydi.' : 'Tashxis faqat tasdiqlangan qayddan olinadi — avval qaydni tasdiqlang.'}</span></span>
          </label>
          <Field label="Uyda davolanish tavsiyasi, kun (0 — yo‘q)" error={errors.rest_days} hint="Bu mehnatga layoqatsizlik varaqasi emas">
            {(id) => <Input id={id} type="number" min={0} max={30} className="w-28" value={cert.rest_days} onChange={(e) => setCert({ ...cert, rest_days: e.target.value })} invalid={!!errors.rest_days} />}
          </Field>
          <Field label="Izoh (ixtiyoriy)">{(id) => <Textarea id={id} rows={2} value={cert.notes} onChange={(e) => setCert({ ...cert, notes: e.target.value })} />}</Field>
        </>}

        {kind === 'prescription' && <>
          {errors.items && <Alert tone="red">{errors.items}</Alert>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] table-fixed text-sm">
              <colgroup><col className="w-[19%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[22%]" /><col className="w-[11%]" /><col className="w-[23%]" /><col className="w-10" /></colgroup>
              <thead><tr className="text-left text-2xs font-semibold uppercase tracking-wide text-slate-500"><th className="pb-1">Dori</th><th className="pb-1">Shakli</th><th className="pb-1">Doza</th><th className="pb-1">Qabul tartibi</th><th className="pb-1">Muddati</th><th className="pb-1">Ko‘rsatma</th><th /></tr></thead>
              <tbody>{items.map((it, i) => (
                <tr key={i} className="align-top">
                  {(['name', 'form', 'dose', 'frequency', 'duration', 'instructions'] as (keyof Item)[]).map((k) => (
                    <td key={k} className="py-1 pr-1"><Input aria-label={`${i + 1}-dori: ${k}`} className="h-8 text-[13px]" value={it[k]} onChange={(e) => setItem(i, k, e.target.value)}
                      invalid={!!errors[`items.${i}.${k}`]} placeholder={{ name: 'Amlodipin', form: 'tabletka', dose: '5 mg', frequency: 'kuniga 1 marta', duration: '30 kun', instructions: 'ovqatdan keyin' }[k]} /></td>
                  ))}
                  <td className="py-1"><Button size="sm" variant="ghost" aria-label="Qatorni o‘chirish" disabled={items.length === 1} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} disabled={items.length >= 15} onClick={() => setItems((xs) => [...xs, emptyItem()])}>Dori qo‘shish</Button>
          <Field label="Umumiy tavsiya (ixtiyoriy)">{(id) => <Textarea id={id} rows={2} value={rxNotes} onChange={(e) => setRxNotes(e.target.value)} />}</Field>
          <p className="text-xs text-slate-500">Klinika ichki retsepti (dori tavsiyasi). Davlat elektron retsepti (DMED) emas — u integratsiyadan keyin qo‘shiladi.</p>
        </>}
      </div>
    </Modal>
  );
}
