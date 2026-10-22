'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleX, Send, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Alert, Button, Field, Modal, useToast } from './ui';

/** The person whose face goes to the camera: a staff code (S-n) or a patient code (P-<number>). */
export type FaceSubject = { face_code_id: string; code: string; name: string };
type EnrolCamera = { id: string; name: string; branch_id: string };
type EnrolResult = { camera_id: string; camera_name: string; ok: boolean; detail: string };
const KB = 1024, MIN = 20 * KB, MAX = 300 * KB;
const ic = 'h-4 w-4';

/**
 * «Rasm yuklash»: a JPEG from disk or the phone's camera is checked in the browser (type, 20–300 KB), previewed from
 * memory and sent to the chosen connected cameras. Nothing of the picture reaches the server's storage; the API
 * forwards it to the camera and drops it.
 */
export function FacePhotoModal({ subject, onClose }: { subject: FaceSubject | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const cams = useQuery({ queryKey: ['cameras', 'face-codes'], queryFn: () => api<{ data: unknown[]; meta: { enrol_cameras: EnrolCamera[] } }>('/cameras/face-codes'), enabled: !!subject });
  const targets = useMemo(() => cams.data?.meta.enrol_cameras ?? [], [cams.data]);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null); // null = «all» until the person unticks one
  const [results, setResults] = useState<EnrolResult[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (subject) { setFile(null); setFileError(null); setPicked(null); setResults(null); setFormError(null); } }, [subject]);
  // the preview lives only in memory and is released when the file changes or the window closes
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const selected = picked ?? targets.map((c) => c.id);
  const kb = (n: number) => Math.round(n / KB);
  const units = { jpeg: 'JPEG', kb: 'KB', unit: 'KB' };

  const choose = (f: File | null) => {
    setResults(null); setFormError(null); setFile(null);
    if (!f) { setFileError(null); return; }
    const isJpeg = f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name);
    if (!isJpeg) { setFileError(t('cam.photo.badType', units)); return; }
    if (f.size < MIN) { setFileError(t('cam.photo.tooSmall', { kb: kb(f.size), unit: 'KB' })); return; }
    if (f.size > MAX) { setFileError(t('cam.photo.tooBig', { kb: kb(f.size), unit: 'KB' })); return; }
    setFileError(null); setFile(f);
  };
  const toggle = (id: string) => setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const m = useMutation({
    mutationFn: async () => {
      const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file!); });
      return api<{ data: { code: string; results: EnrolResult[]; enrolled: number } }>(`/cameras/face-codes/${subject!.face_code_id}/photo`, { method: 'POST', body: { photo_base64: b64, camera_ids: selected } });
    },
    onSuccess: (r) => {
      setResults(r.data.results);
      qc.invalidateQueries({ queryKey: ['cameras'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      if (r.data.enrolled) toast.success(t('cam.photo.sent', { n: r.data.enrolled }));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields?.photo) setFileError(e.fields.photo);
      setFormError(e instanceof Error ? e.message : String(e));
    },
  });
  const submit = () => {
    setFormError(null);
    if (!file) { setFileError(t('cam.photo.choose')); return; }
    if (!selected.length) { setFormError(t('cam.photo.pickCamera')); return; }
    m.mutate();
  };
  const done = !!results;
  return (
    <Modal open={!!subject} onClose={onClose} title={subject ? t('cam.photo.title', { name: subject.name, code: subject.code }) : ''} dirty={!!file && !done}
      footer={<>
        <Button onClick={onClose}>{t(done ? 'common.close' : 'common.cancel')}</Button>
        <Button variant="primary" icon={<Send className={ic} />} loading={m.isPending} disabled={!targets.length} onClick={submit}>{t('cam.photo.send')}</Button>
      </>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {formError && <Alert tone="red">{formError}</Alert>}
        {cams.data && !targets.length && <Alert tone="yellow">{t('cam.photo.noCameras')}</Alert>}
        <Field label={t('cam.photo.file', units)} required error={fileError ?? undefined} hint={t('cam.photo.notStored')}>{(id) => (
          <div className="flex flex-wrap items-center gap-3">
            <input ref={input} id={id} type="file" accept="image/jpeg" capture="user" className="sr-only" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
            <Button type="button" data-autofocus icon={<Upload className={ic} />} onClick={() => input.current?.click()}>{t('cam.photo.upload')}</Button>
            {preview && file && (
              <span className="flex min-w-0 items-center gap-3">
                <img src={preview} alt={t('cam.photo.preview')} className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                <span className="min-w-0 break-all text-[0.8125rem] text-slate-700">{t('cam.photo.size', { name: file.name, kb: kb(file.size), unit: 'KB' })}</span>
              </span>
            )}
          </div>
        )}</Field>
        {targets.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-800">{t('cam.photo.cameras')}</legend>
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {targets.map((c) => {
                const r = results?.find((x) => x.camera_id === c.id);
                return (
                  <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] text-slate-900">
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                    <span className="min-w-0">
                      {c.name}
                      {r && <span className={`ml-2 inline-flex items-center gap-1 text-[0.8125rem] font-semibold ${r.ok ? 'text-emerald-800' : 'text-red-700'}`}>{r.ok ? <CheckCircle2 className={ic} aria-hidden="true" /> : <CircleX className={ic} aria-hidden="true" />}{r.detail}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
