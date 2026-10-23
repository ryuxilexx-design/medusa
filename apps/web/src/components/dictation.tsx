'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import type { DictationTarget, MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, cx } from '@/components/ui';

/**
 * Doctor dictation: the browser records (MediaRecorder, webm/opus — mp4 on Safari), the API hands the recording to
 * the clinic's speech server and answers the text. The recording lives only in this tab's memory until it is sent;
 * nothing is stored in the browser.
 */
export const MAX_SECONDS = 180;
export type DictLang = 'uz' | 'ru';
export type DictResult = {
  text: string; seconds: number; field: DictationTarget; language: DictLang;
  draft: { mode: 'sample' | 'live'; draft: Record<string, string> } | null;
  draft_error: { code: string; message: string } | null;
};
type Phase = 'idle' | 'starting' | 'recording' | 'sending';

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
const pickMime = () => (typeof MediaRecorder === 'undefined' ? '' : MIMES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '');
const fileName = (mime: string) => `dictation.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** getUserMedia failures → the message the doctor needs (permission, no device, busy, unsupported). */
function micError(e: unknown): MessageKey {
  const name = (e as Error)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'dict.micDenied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'dict.noMic';
  if (name === 'NotReadableError' || name === 'AbortError') return 'dict.micBusy';
  return 'dict.unsupported';
}

/** One recorder for the page: one dictation at a time, into one target (a note field or the whole note). */
export function useDictation({ encounterId, structure, onResult }: { encounterId: string; structure: boolean; onResult: (r: DictResult) => void }) {
  const { me } = useSession();
  const t = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<DictationTarget | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<{ target: DictationTarget; text: string } | null>(null);
  const [lang, setLang] = useState<DictLang>(me.locale === 'ru' ? 'ru' : 'uz');
  // the browser's remembered decision: a blocked microphone is named next to the buttons before anyone presses one
  const [micBlocked, setMicBlocked] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(0);
  const cancelled = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const langRef = useRef(lang); langRef.current = lang;
  const onResultRef = useRef(onResult); onResultRef.current = onResult;

  useEffect(() => {
    let status: PermissionStatus | null = null;
    const update = () => setMicBlocked(status?.state === 'denied');
    navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((s) => { status = s; update(); s.addEventListener('change', update); }).catch(() => undefined);
    return () => status?.removeEventListener('change', update);
  }, []);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null; rec.current = null;
  }, []);
  useEffect(() => () => { cancelled.current = true; abort.current?.abort(); try { rec.current?.stop(); } catch { /* already stopped */ } release(); }, [release]);

  const send = useCallback(async (tg: DictationTarget, mime: string, secs: number) => {
    const blob = new Blob(chunks.current, { type: mime || 'audio/webm' });
    chunks.current = [];
    if (!blob.size) { setPhase('idle'); setTarget(null); setError({ target: tg, text: t('dict.empty') }); return; }
    const form = new FormData();
    form.append('field', tg); form.append('encounter_id', encounterId); form.append('language', langRef.current);
    form.append('seconds', String(Math.round(secs))); if (tg === 'all' && structure) form.append('structure', '1');
    form.append('audio', blob, fileName(blob.type));
    setPhase('sending');
    abort.current = new AbortController();
    try {
      const r = await api<{ data: DictResult }>('/dictation', { method: 'POST', body: form, signal: abort.current.signal });
      onResultRef.current(r.data);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError({ target: tg, text: t('dict.failed', { msg: (e as ApiError).message.trim().replace(/([^.!?…])$/, '$1.') }) });
    } finally {
      abort.current = null; setPhase('idle'); setTarget(null);
    }
  }, [encounterId, structure, t]);

  const stop = useCallback(() => { if (rec.current?.state === 'recording') rec.current.stop(); }, []);

  const start = useCallback(async (tg: DictationTarget) => {
    if (phase !== 'idle') return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError({ target: tg, text: t('dict.unsupported') }); return; }
    setTarget(tg); setPhase('starting'); setSeconds(0); cancelled.current = false; chunks.current = [];
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      setMicBlocked(false);
      // cancelled (or the page left) while the browser was asking for the microphone: give it straight back
      if (cancelled.current) { media.getTracks().forEach((tr) => tr.stop()); return; }
      stream.current = media;
    } catch (e) {
      const key = micError(e);
      if (key === 'dict.micDenied') setMicBlocked(true);
      release(); setPhase('idle'); setTarget(null); setError({ target: tg, text: t(key) }); return;
    }
    const mime = pickMime();
    let r: MediaRecorder;
    try { r = new MediaRecorder(stream.current, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 }); } catch {
      release(); setPhase('idle'); setTarget(null); setError({ target: tg, text: t('dict.unsupported') }); return;
    }
    rec.current = r;
    r.ondataavailable = (ev) => { if (ev.data.size) chunks.current.push(ev.data); };
    r.onstop = () => {
      const secs = (Date.now() - started.current) / 1000;
      const type = r.mimeType || mime;
      release();
      if (cancelled.current) { chunks.current = []; setPhase('idle'); setTarget(null); return; }
      void send(tg, type, secs);
    };
    started.current = Date.now();
    r.start(1000);
    setPhase('recording');
    timer.current = setInterval(() => {
      const s = (Date.now() - started.current) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS && rec.current?.state === 'recording') rec.current.stop();
    }, 250);
  }, [phase, release, send, t]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (phase === 'sending') abort.current?.abort();
    else if (rec.current?.state === 'recording') rec.current.stop();
    else { release(); setPhase('idle'); setTarget(null); }
  }, [phase, release]);

  return { phase, target, seconds, error, clearError: () => setError(null), lang, setLang, micBlocked, start, stop, cancel, busy: phase !== 'idle' };
}
export type Dictation = ReturnType<typeof useDictation>;

/** The microphone button of one target; while another target records it is disabled. */
export function MicButton({ d, target, label, className, children, onBeforeStart, variant = 'ghost' }: { d: Dictation; target: DictationTarget; label: string; className?: string; children?: React.ReactNode; onBeforeStart?: () => void; variant?: 'ghost' | 'secondary' }) {
  const active = d.target === target && d.busy;
  return (
    <Button size="sm" variant={variant} className={className} data-testid={`dict-${target}`} aria-label={label} title={label}
      disabled={d.busy && !active} aria-pressed={active} onPointerDown={onBeforeStart} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBeforeStart?.(); }}
      icon={<Mic className={cx('h-4 w-4', active ? 'text-red-600' : 'text-brand-600')} />} onClick={() => (active ? undefined : d.start(target))}>
      {children}
    </Button>
  );
}

/** Recording / sending state of the active target: timer, language, stop-and-send, cancel; the error line otherwise. */
export function DictationBar({ d, target }: { d: Dictation; target: DictationTarget }) {
  const t = useT();
  const stopRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const mine = d.target === target;
  // the bar may open under the sticky note actions (phone): bring it to the middle; the stop button takes the focus
  useEffect(() => { if (mine && d.phase === 'starting') barRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [mine, d.phase]);
  useEffect(() => { if (mine && d.phase === 'recording') stopRef.current?.focus({ preventScroll: true }); }, [mine, d.phase]);
  if (d.error?.target === target && !d.busy) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert" data-testid="dict-error">
        <span className="flex-1">{d.error.text}</span>
        <button type="button" className="rounded p-1 text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" aria-label={t('common.close')} onClick={d.clearError}><X className="h-4 w-4" /></button>
      </div>
    );
  }
  if (d.target !== target || !d.busy) return null;
  const left = Math.max(0, MAX_SECONDS - d.seconds);
  return (
    <div ref={barRef} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" data-testid="dict-bar" aria-live="polite">
      {d.phase === 'recording' ? (
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />{t('dict.recording')}
          <span className={cx('tabular-nums', left < 20 ? 'text-red-700' : 'text-slate-700')}>{clock(d.seconds)} / {clock(MAX_SECONDS)}</span>
        </span>
      ) : (
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Loader2 className="h-4 w-4 animate-spin" />{t(d.phase === 'sending' ? 'dict.sending' : 'dict.starting')}</span>
      )}
      {d.phase !== 'sending' && (
        <span role="group" aria-label={t('dict.language')} className="inline-flex overflow-hidden rounded-full border border-slate-300 bg-white text-[0.8125rem]">
          {(['uz', 'ru'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={d.lang === l} onClick={() => d.setLang(l)}
              className={cx('min-h-9 px-3 font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', d.lang === l ? 'bg-brand-600 text-white' : 'text-slate-800 hover:bg-slate-100')}>
              {t(l === 'uz' ? 'dict.langUz' : 'dict.langRu')}
            </button>
          ))}
        </span>
      )}
      <span className="ml-auto flex flex-wrap gap-2">
        {d.phase === 'recording' && <Button ref={stopRef} size="sm" variant="primary" icon={<Square className="h-4 w-4" />} onClick={d.stop} data-testid="dict-stop">{t('dict.stop')}</Button>}
        <Button size="sm" variant="ghost" onClick={d.cancel} data-testid="dict-cancel">{t('common.cancel')}</Button>
      </span>
    </div>
  );
}
