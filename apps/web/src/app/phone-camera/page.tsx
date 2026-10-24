'use client';
// Demo / test only: turns a phone into a stand-in for a Hikvision DeepinView camera. The phone recognises faces
// itself (face-api, in the browser) and sends the camera's push address only what a real camera sends:
// «code + similarity» (ISAPI alarmResult), plus people counting, intrusion and heartbeat messages.
// Faces and face descriptors stay in this page's memory on the phone — never stored, never sent; closing the page
// forgets them. The event time is left to the server (the demo clock), as if the camera's clock matched it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, DoorOpen, HeartPulse, Loader2, RefreshCw, ScanFace, ShieldAlert, Trash2, UserPlus } from 'lucide-react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { BrandLockup } from '@/components/logo';
import { LanguagePicker } from '@/components/prefs';
import { useT } from '@/lib/i18n';

const FACE_API = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js';
const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
/** face-api distance → camera-style similarity: 0 → 100 %, 0.4 → 80 % (the server ignores matches below 80 %). */
const similarityOf = (distance: number) => Math.max(0, Math.min(100, Math.round(100 - distance * 50)));
const MAX_DISTANCE = 0.45;
/** The same person is reported at most once a minute (a real camera also throttles repeated matches). */
const RESEND_MS = 60_000;

type Enrolled = { code: string; descriptor: Float32Array };
type LogLine = { at: string; text: string; ok: boolean | null };
declare global { interface Window { faceapi?: any } }

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.faceapi) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve(); s.onerror = () => reject(new Error('script'));
    document.head.appendChild(s);
  });
}

/** The push path from what the person pasted: a full address, a path, or the bare token. */
function pushPath(input: string): string | null {
  const v = input.trim();
  const m = /\/api\/v1\/hik\/([A-Za-z0-9_-]{20,64})\/?$/.exec(v) ?? /^([A-Za-z0-9_-]{20,64})$/.exec(v);
  return m ? `/api/v1/hik/${m[1]}` : null;
}

const xml = (type: string, body = '') => `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<ipAddress>0.0.0.0</ipAddress><channelID>1</channelID><activePostCount>1</activePostCount>
<eventType>${type}</eventType><eventState>${type === 'videoloss' ? 'inactive' : 'active'}</eventState><eventDescription>${type} alarm</eventDescription>
${body}<channelName>Telefon</channelName></EventNotificationAlert>`;

export default function PhoneCameraPage() {
  const t = useT();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [address, setAddress] = useState('');
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [camOn, setCamOn] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [camError, setCamError] = useState<string | null>(null);
  const [code, setCode] = useState('S-1');
  const [enrolled, setEnrolled] = useState<Enrolled[]>([]);
  const [seen, setSeen] = useState<{ code: string | null; sim: number | null }[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const lastSent = useRef<Record<string, number>>({});
  const enrolledRef = useRef<Enrolled[]>([]);
  enrolledRef.current = enrolled;
  const path = pushPath(address);

  // only on a demo / test server (the real clinic's server answers 404 here)
  useEffect(() => {
    fetch('/api/v1/demo/accounts').then((r) => setAvailable(r.status !== 404)).catch(() => setAvailable(false));
    const h = window.location.hash.replace(/^#/, '');
    if (h) setAddress(h);
  }, []);

  const addLog = useCallback((text: string, ok: boolean | null) => {
    setLog((l) => [{ at: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text, ok }, ...l].slice(0, 30));
  }, []);

  const send = useCallback(async (label: string, body: string, contentType: string, heartbeat = false) => {
    if (!path) { addLog(t('cam.phone.noAddress'), false); return; }
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': contentType }, body });
      if (r.status === 404) { addLog(`${label}: ${t('cam.phone.badAddress')}`, false); return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) addLog(`${label}: ${t('cam.phone.serverError', { status: r.status })}`, false);
      else if (heartbeat) addLog(`${label}: ${t('cam.phone.heard')}`, true);
      else if (j.stored > 0) addLog(`${label}: ${t('cam.phone.stored')}`, true);
      else addLog(`${label}: ${t('cam.phone.notStored')}`, null);
    } catch { addLog(`${label}: ${t('cam.phone.network')}`, false); }
  }, [path, addLog, t]);

  async function loadModels() {
    setModelState('loading');
    try {
      await loadScript(FACE_API);
      const f = window.faceapi;
      await Promise.all([f.nets.tinyFaceDetector.loadFromUri(MODELS), f.nets.faceLandmark68Net.loadFromUri(MODELS), f.nets.faceRecognitionNet.loadFromUri(MODELS)]);
      setModelState('ready');
    } catch { setModelState('failed'); }
  }

  async function startCamera(mode = facing) {
    setCamError(null);
    stream.current?.getTracks().forEach((tr) => tr.stop());
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play(); }
      setCamOn(true);
      if (modelState === 'idle') void loadModels();
    } catch (e) {
      setCamError(window.isSecureContext ? t('cam.phone.camDenied') : t('cam.phone.needHttps', { proto: 'HTTPS' }));
    }
  }
  useEffect(() => () => stream.current?.getTracks().forEach((tr) => tr.stop()), []);

  // recognition loop: find faces, match them with the faces added on this phone, report a match like a camera
  useEffect(() => {
    if (!camOn || modelState !== 'ready') return;
    let stop = false;
    const f = window.faceapi;
    const tick = async () => {
      if (stop || !video.current || video.current.readyState < 2) { if (!stop) setTimeout(tick, 500); return; }
      try {
        const faces = await f.detectAllFaces(video.current, new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptors();
        const found: { code: string | null; sim: number | null; box: any }[] = faces.map((d: any) => {
          let best: { code: string; dist: number } | null = null;
          for (const e of enrolledRef.current) {
            const dist = f.euclideanDistance(d.descriptor, e.descriptor);
            if (!best || dist < best.dist) best = { code: e.code, dist };
          }
          return best && best.dist <= MAX_DISTANCE ? { code: best.code, sim: similarityOf(best.dist), box: d.detection.box } : { code: null, sim: null, box: d.detection.box };
        });
        setSeen(found.map(({ code, sim }) => ({ code, sim })));
        draw(found);
        for (const m of found) {
          if (!m.code || m.sim == null) continue;
          if (Date.now() - (lastSent.current[m.code] ?? 0) < RESEND_MS) continue;
          lastSent.current[m.code] = Date.now();
          const s = m.sim / 100;
          void send(`${m.code} ${m.sim}%`, JSON.stringify({
            ipAddress: '0.0.0.0', channelID: 1, activePostCount: 1, eventType: 'alarmResult', eventState: 'active', eventDescription: 'alarmResult',
            alarmResult: [{ targetAttrs: { deviceChannel: 1, deviceName: 'PHONE' }, faces: [{ identify: [{ maxsimilarity: s, candidate: [{ reserve_field: { certificateNumber: m.code }, similarity: s }] }] }] }],
          }), 'application/json');
        }
      } catch { /* a dropped frame */ }
      if (!stop) setTimeout(tick, 700);
    };
    void tick();
    return () => { stop = true; };
  }, [camOn, modelState, send]);

  function draw(found: { code: string | null; sim: number | null; box: any }[]) {
    const v = video.current, c = overlay.current;
    if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.lineWidth = 4; g.font = 'bold 22px sans-serif';
    for (const m of found) {
      g.strokeStyle = m.code ? '#059669' : '#f59e0b';
      g.strokeRect(m.box.x, m.box.y, m.box.width, m.box.height);
      const label = m.code ? `${m.code} ${m.sim}%` : '?';
      g.fillStyle = m.code ? '#059669' : '#f59e0b';
      g.fillRect(m.box.x, m.box.y - 30, g.measureText(label).width + 16, 30);
      g.fillStyle = '#fff'; g.fillText(label, m.box.x + 8, m.box.y - 8);
    }
  }

  async function enroll() {
    const c = code.trim().toUpperCase();
    if (!/^[SP]-\d{1,9}$/.test(c)) { addLog(t('cam.phone.badCode', { staff: 'S-12', patient: 'P-1001' }), false); return; }
    const f = window.faceapi;
    if (!f || !video.current) return;
    const d = await f.detectSingleFace(video.current, new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptor();
    if (!d) { addLog(t('cam.phone.noFace'), false); return; }
    setEnrolled((l) => [...l.filter((e) => e.code !== c), { code: c, descriptor: d.descriptor }]);
    delete lastSent.current[c];
    addLog(t('cam.phone.enrolled', { code: c }), true);
  }

  if (available === false) return (
    <main className="mx-auto max-w-lg px-4 py-10"><BrandLockup /><div className="mt-6"><Alert tone="yellow">{t('cam.phone.demoOnly')}</Alert></div></main>
  );

  return (
    <main className="min-h-screen bg-slate-100">
      <title>{`${t('cam.phone.title')} — Med.uz.ai`}</title>
      <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4"><BrandLockup /><LanguagePicker /></div>
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('cam.phone.title')}</h1>
          <p className="mt-1 text-body text-slate-600">{t('cam.phone.subtitle', { brand: 'Hikvision' })}</p>
        </div>
        <Alert tone="blue">{t('cam.phone.privacy')}</Alert>

        <section className="space-y-3 surface p-5">
          <Field label={t('cam.phone.address')} hint={t('cam.phone.addressHint')} error={address && !path ? t('cam.phone.badAddress') : undefined}>
            {(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://…/api/v1/hik/…" className="font-mono text-sm" autoComplete="off" />}
          </Field>
          <div className="flex flex-wrap gap-2">
            {!camOn
              ? <Button variant="primary" icon={<CameraIcon className="h-5 w-5" />} onClick={() => void startCamera()}>{t('cam.phone.start')}</Button>
              : <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => { const m = facing === 'user' ? 'environment' : 'user'; setFacing(m); void startCamera(m); }}>{t('cam.phone.flip')}</Button>}
          </div>
          {camError && <Alert tone="red">{camError}</Alert>}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-black" hidden={!camOn}>
          <div className="relative">
            <video ref={video} playsInline muted className="block w-full" style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined} />
            <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined} />
            {modelState === 'loading' && <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-4 py-2 text-sm text-white"><Loader2 className="h-4 w-4 animate-spin" />{t('cam.phone.loadingModels')}</div>}
          </div>
        </section>
        {modelState === 'failed' && <Alert tone="red">{t('cam.phone.modelsFailed')}</Alert>}

        {camOn && modelState === 'ready' && (
          <section className="space-y-3 surface p-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><ScanFace className="h-5 w-5 text-brand-600" />{t('cam.phone.enrollTitle')}</h2>
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('cam.phone.code')} className="w-36">{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />}</Field>
              <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => void enroll()}>{t('cam.phone.enroll')}</Button>
            </div>
            <p className="text-small text-slate-600">{t('cam.phone.enrollHint', { app: 'Med.uz.ai', staff: 'S-…', patient: 'P-…' })}</p>
            {enrolled.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {enrolled.map((e) => (
                  <li key={e.code} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 py-0.5 pl-4 pr-0.5 text-sm font-semibold text-slate-900">
                    {e.code}
                    <Button variant="ghost" size="icon-sm" aria-label={t('cam.phone.remove', { code: e.code })} onClick={() => setEnrolled((l) => l.filter((x) => x.code !== e.code))} className="!h-10 !w-10 !text-slate-600 hover:!text-slate-900"><Trash2 className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-slate-800" aria-live="polite">{seen.length === 0 ? t('cam.phone.noFaceNow') : seen.map((s) => (s.code ? `${s.code} ${s.sim}%` : t('cam.phone.unknown'))).join(' · ')}</p>
          </section>
        )}

        <section className="space-y-3 surface p-5">
          <h2 className="text-base font-bold text-slate-900">{t('cam.phone.otherEvents')}</h2>
          <div className="flex flex-wrap gap-2">
            <Button icon={<DoorOpen className="h-4 w-4" />} onClick={() => void send(t('cam.phone.enter'), xml('PeopleCounting', '<peopleCounting><statisticalMethods>timeRange</statisticalMethods><enter>1</enter><exit>0</exit></peopleCounting>'), 'application/xml')}>{t('cam.phone.enter')}</Button>
            <Button icon={<ShieldAlert className="h-4 w-4" />} onClick={() => void send(t('cam.phone.intrusion'), xml('fielddetection', '<DetectionRegionList><DetectionRegionEntry><regionID>1</regionID><detectionTarget>human</detectionTarget></DetectionRegionEntry></DetectionRegionList>'), 'application/xml')}>{t('cam.phone.intrusion')}</Button>
            <Button icon={<HeartPulse className="h-4 w-4" />} onClick={() => void send(t('cam.phone.heartbeat'), xml('videoloss'), 'application/xml', true)}>{t('cam.phone.heartbeat')}</Button>
          </div>
        </section>

        {log.length > 0 && (
          <section className="surface p-5">
            <h2 className="mb-2 text-base font-bold text-slate-900">{t('cam.phone.log')}</h2>
            <ul className="space-y-1.5 text-sm">
              {log.map((l, i) => (
                <li key={i} className="flex gap-3"><span className="shrink-0 tabular-nums text-slate-500">{l.at}</span>
                  <span className={l.ok === true ? 'text-emerald-800' : l.ok === false ? 'text-red-700' : 'text-amber-800'}>{l.text}</span></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
