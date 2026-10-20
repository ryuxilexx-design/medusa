// Hikvision ISAPI event notifications (DeepinView cameras, HTTP listening / alertStream) → NormalizedEvent.
// The body can be plain XML or JSON, or multipart (form-data from HTTP listening, mixed from alertStream) with
// picture parts. Pictures are dropped unread: a face crop is biometric data and never leaves this function.
// XML namespaces differ by firmware (hikvision.com/ver20, isapi.org/ver20, urn:psialliance-org), so elements are
// matched by local name only. Formats and sources: docs/HIKVISION_ISAPI_RESEARCH.md; setup: docs/HIKVISION.md.
import { createHash } from 'crypto';
import type { EventKind, NormalizedEvent } from './ingest';
import { now } from '../core/clock';

export type Parsed = { events: NormalizedEvent[]; heartbeat: boolean; unknown: string[] };

const KIND_BY_TYPE: Record<string, EventKind> = {
  alarmresult: 'face_match', facecontrast: 'face_match', facesnapmatch: 'face_match', facecontrastsuccess: 'face_match',
  peoplecounting: 'people_count',
  fielddetection: 'intrusion', linedetection: 'line_crossing', regionentrance: 'region_entrance', regionexiting: 'region_exit',
  shelteralarm: 'tamper', tamperdetection: 'tamper',
};
/** Recognised but not useful to us (a face seen without a library match, motion, heartbeats). */
const IGNORED = new Set(['facecapture', 'facesnap', 'vmd', 'motiondetection', 'videoloss', 'duration', 'whitefacecontrast', 'humanrecognition', 'targetcapture']);

const CODE_RE = /\b([SP])-(\d{1,9})\b/i;
export const findCode = (s: unknown): string | null => {
  const m = typeof s === 'string' ? CODE_RE.exec(s) : null;
  return m ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
};

/** ISO date with the camera's offset; a time without an offset is taken as Tashkent time (+05:00). */
export function parseCameraTime(s: unknown): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.trim())) return null;
  const v = s.trim();
  const d = new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : v + '+05:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------- multipart ----------
/** The non-picture parts of a multipart body (form-data or mixed), as text. */
export function multipartTextParts(body: Buffer, contentType: string): string[] {
  const b = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!b) return [];
  const text = body.toString('latin1'); // byte-preserving; text parts are re-decoded as UTF-8 below
  const out: string[] = [];
  for (const chunk of text.split('--' + b)) {
    const sep = chunk.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const head = chunk.slice(0, sep).toLowerCase();
    if (/content-type:\s*image\//.test(head) || /filename=/.test(head)) continue; // pictures are never read
    const payload = Buffer.from(chunk.slice(sep).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, ''), 'latin1').toString('utf8').trim();
    if (payload.startsWith('<') || payload.startsWith('{')) out.push(payload);
  }
  return out;
}

// ---------- tiny XML access by local name ----------
/** Text of the first element with this local name (anywhere below `xml`). */
function xmlText(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${name}>`, 'i');
  const m = re.exec(xml);
  return m ? decodeXml(m[1]).trim() : null;
}
/** Inner XML of the first element with this local name. */
function xmlBlock(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'i');
  return re.exec(xml)?.[1] ?? null;
}
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const num = (s: unknown) => { const n = typeof s === 'number' ? s : typeof s === 'string' && s.trim() !== '' ? Number(s) : NaN; return Number.isFinite(n) ? n : null; };
/** A count from the camera: a non-negative integer, else nothing (a broken value must not reach the database). */
const count = (s: unknown) => { const n = num(s); return n !== null && n >= 0 && n <= 1_000_000 ? Math.round(n) : null; };
/** 0..1 (or 0..100) → percent; anything else is dropped. */
const similarityPct = (v: unknown) => { const n = num(v); if (n === null || n < 0) return null; const p = n <= 1 ? n * 100 : n; return p <= 100 ? Math.round(p * 100) / 100 : null; };
const target = (s: unknown): NormalizedEvent['target'] => (s === 'human' || s === 'vehicle' ? s : s ? 'other' : null);
const minuteKey = (d: Date) => d.toISOString().slice(0, 16);
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

// ---------- one notification ----------
interface Envelope { type: string; state: string; time: Date | null; channel: string; uuid: string | null; retransmit: boolean }

function securityEvent(kind: EventKind, env: Envelope, detectionTarget: unknown): NormalizedEvent {
  const at = env.time ?? now();
  // durative alarms repeat with a growing activePostCount: one stored event per kind, channel and minute
  return { kind, occurredAt: at, target: kind === 'tamper' ? null : target(detectionTarget), sourceKey: `${kind}:${env.channel}:${minuteKey(at)}` };
}

function fromXml(xml: string, out: Parsed) {
  const env: Envelope = {
    type: (xmlText(xml, 'eventType') ?? '').toLowerCase(), state: (xmlText(xml, 'eventState') ?? 'active').toLowerCase(),
    time: parseCameraTime(xmlText(xml, 'dateTime')), channel: xmlText(xml, 'channelID') ?? xmlText(xml, 'dynChannelID') ?? '1', uuid: xmlText(xml, 'uuid'),
    retransmit: xmlText(xml, 'isDataRetransmission') === 'true',
  };
  if (env.type === 'videoloss' && env.state === 'inactive') { out.heartbeat = true; return; }
  const kind = KIND_BY_TYPE[env.type];
  if (!kind) { if (!IGNORED.has(env.type)) out.unknown.push(env.type || '?'); return; }
  if (env.state === 'inactive') return;
  if (kind === 'people_count') {
    const pc = xmlBlock(xml, 'peopleCounting') ?? xml;
    const enter = count(xmlText(pc, 'enter')), exit = count(xmlText(pc, 'exit'));
    if (enter === null && exit === null) return;
    const method = (xmlText(pc, 'statisticalMethods') ?? 'realTime').toLowerCase();
    if (method === 'timerange') {
      const end = parseCameraTime(xmlText(pc, 'endTime')) ?? env.time ?? now();
      const start = xmlText(pc, 'startTime') ?? '';
      out.events.push({ kind, occurredAt: end, enter: enter ?? 0, exit: exit ?? 0, sourceKey: `pc:range:${start}:${end.toISOString()}` });
    } else {
      const at = parseCameraTime(xmlText(pc, 'time')) ?? env.time ?? now();
      // real-time counts are running totals since the camera's daily reset: ingest turns them into differences
      out.events.push({ kind, occurredAt: at, enter: enter ?? 0, exit: exit ?? 0, cumulative: true, sourceKey: `pc:rt:${at.toISOString()}:${enter}:${exit}` });
    }
    return;
  }
  if (kind === 'face_match') {
    // XML form of a library match: look for our code in certificateNumber, then name
    const code = findCode(xmlText(xml, 'certificateNumber')) ?? findCode(xmlText(xml, 'name'));
    const at = parseCameraTime(xmlText(xml, 'faceTime')) ?? env.time ?? now();
    out.events.push({ kind, occurredAt: at, code, similarity: similarityPct(xmlText(xml, 'similarity') ?? xmlText(xml, 'maxsimilarity')), sourceKey: `face:${code}:${minuteKey(at)}` });
    return;
  }
  out.events.push(securityEvent(kind, env, xmlText(xml, 'detectionTarget')));
}

/** Best library candidate of a JSON face comparison (alarmResult / faceContrast). */
function bestCandidate(o: any): { code: string | null; similarity: number | null; time: Date | null } | null {
  const results: any[] = Array.isArray(o?.alarmResult) ? o.alarmResult : Array.isArray(o?.faceContrast) ? o.faceContrast : [];
  let best: { code: string | null; similarity: number | null; time: Date | null } | null = null;
  for (const r of results) {
    const time = parseCameraTime(r?.targetAttrs?.faceTime);
    for (const f of Array.isArray(r?.faces) ? r.faces : []) for (const idf of Array.isArray(f?.identify) ? f.identify : []) {
      for (const c of Array.isArray(idf?.candidate) ? idf.candidate : []) {
        const rf = c?.reserve_field;
        const code = typeof rf === 'string' ? findCode(rf) : findCode(rf?.certificateNumber) ?? findCode(rf?.name) ?? findCode(rf?.customHumanID);
        const sim = similarityPct(c?.similarity ?? idf?.maxsimilarity);
        if (code && (!best || (sim ?? 0) > (best.similarity ?? 0))) best = { code, similarity: sim, time };
      }
    }
  }
  return best;
}

function fromJson(o: any, out: Parsed) {
  if (!o || typeof o !== 'object') return;
  const env: Envelope = {
    type: String(o.eventType ?? '').toLowerCase(), state: String(o.eventState ?? 'active').toLowerCase(), time: parseCameraTime(o.dateTime),
    channel: String(o.channelID ?? '1'), uuid: typeof o.uuid === 'string' ? o.uuid : null, retransmit: !!o.isDataRetransmission,
  };
  if (env.type === 'videoloss' && env.state === 'inactive') { out.heartbeat = true; return; }
  const kind = KIND_BY_TYPE[env.type];
  if (!kind) { if (!IGNORED.has(env.type)) out.unknown.push(env.type || '?'); return; }
  if (env.state === 'inactive') return;
  if (kind === 'face_match') {
    const b = bestCandidate(o);
    const at = b?.time ?? env.time ?? now();
    out.events.push({ kind, occurredAt: at, code: b?.code ?? null, similarity: b?.similarity ?? null, sourceKey: `face:${b?.code}:${minuteKey(at)}` });
    return;
  }
  if (kind === 'people_count') {
    const pc = o.peopleCounting ?? o.PeopleCounting ?? o;
    const enter = count(pc.enter), exit = count(pc.exit);
    if (enter === null && exit === null) return;
    if (String(pc.statisticalMethods ?? '').toLowerCase() === 'timerange') {
      const end = parseCameraTime(pc.TimeRange?.endTime ?? pc.timeRange?.endTime) ?? env.time ?? now();
      out.events.push({ kind, occurredAt: end, enter: enter ?? 0, exit: exit ?? 0, sourceKey: `pc:range:${pc.TimeRange?.startTime ?? ''}:${end.toISOString()}` });
    } else {
      const at = parseCameraTime(pc.RealTime?.time ?? pc.realTime?.time) ?? env.time ?? now();
      out.events.push({ kind, occurredAt: at, enter: enter ?? 0, exit: exit ?? 0, cumulative: true, sourceKey: `pc:rt:${at.toISOString()}:${enter}:${exit}` });
    }
    return;
  }
  const det = o.DetectionRegionList?.DetectionRegionEntry;
  const t = o.detectionTarget ?? (Array.isArray(det) ? det[0]?.detectionTarget : det?.detectionTarget);
  out.events.push(securityEvent(kind, env, t));
}

/** Parses one HTTP body from a camera. Unknown event types are reported (not stored); pictures are skipped. */
export function parseIsapi(body: Buffer, contentType = ''): Parsed {
  const out: Parsed = { events: [], heartbeat: false, unknown: [] };
  const ct = contentType.toLowerCase();
  const parts = ct.startsWith('multipart/') ? multipartTextParts(body, contentType) : [body.toString('utf8').trim()];
  for (const p of parts) {
    if (p.startsWith('{')) {
      let o: unknown;
      try { o = JSON.parse(p); } catch { out.unknown.push('bad-json'); continue; } // duplicate keys are fine: the last one wins
      fromJson(o, out);
    } else if (p.startsWith('<')) {
      // one body may hold several notifications (alertStream); handle each EventNotificationAlert
      const alerts = p.match(/<(?:[\w.-]+:)?EventNotificationAlert[\s\S]*?<\/(?:[\w.-]+:)?EventNotificationAlert>/gi) ?? [p];
      for (const a of alerts) fromXml(a, out);
    }
  }
  // an event re-sent after a broken connection must be stored once: keys depend only on the content
  for (const e of out.events) e.sourceKey = e.sourceKey.length > 120 ? hash(e.sourceKey) : e.sourceKey;
  return out;
}
