// A small ISAPI client for Hikvision cameras (DeepinView / DeepinMind / MinMoe): HTTP Digest auth, device info,
// «HTTP listening» host configuration, face libraries and face records. Only what Med.uz.ai needs; every call is
// bounded by a timeout. Formats and sources: docs/HIKVISION_ISAPI_RESEARCH.md (§1a httpHosts, §3 FDLib, §4 digest).
//
// Face pictures pass through here in memory on their way to the camera and are never written anywhere.
import { createHash, randomBytes } from 'crypto';
import { isIP } from 'net';
import { AppError } from '../core/errors';

export interface IsapiTarget { host: string; port: number; https: boolean; username: string; password: string }
export type IsapiResult<T> = { ok: true; value: T } | { ok: false; error: string };

const TIMEOUT_MS = 8_000;
/** Largest answer read from a camera (device info, status, library lists): more is not a camera talking to us. */
const MAX_RESPONSE = 2 * 1024 * 1024;

/** Reads a response body up to `max` bytes; a longer one is cut off and the connection dropped. */
async function readBounded(res: Response, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); throw new IsapiError('Kamera javobi juda katta'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** Error thrown for a camera that answered but refused (bad password, locked, unsupported): the message is for the manager. */
export class IsapiError extends Error {
  constructor(message: string, public status = 0, public code?: string) { super(message); }
}

/** Parses a WWW-Authenticate: Digest header into its fields. */
function parseDigest(h: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of h.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) out[m[1]] = m[2] ?? m[3];
  return out;
}

/**
 * A camera is addressed by its IPv4 address in the clinic's own network (no host names: nothing to resolve, nothing
 * to rebind). Private ranges are allowed; everything that could turn the server into a proxy against itself or its
 * host is not: loopback, link-local / cloud metadata (169.254.0.0/16), unspecified, multicast, reserved, CGNAT.
 * Tests may use 127.0.0.1.
 */
export function assertCameraAddress(host: string): string {
  if (isIP(host) !== 4) throw new IsapiError('Kamera manzili IPv4 ko‘rinishida bo‘lsin (masalan 192.168.1.64)', 0, 'ADDRESS');
  if (!allowedCameraIp(host)) throw new IsapiError('Bu manzilga ulanish mumkin emas: kamera klinika tarmog‘ida bo‘lishi kerak', 0, 'ADDRESS');
  return host;
}
function allowedCameraIp(ip: string): boolean {
  if (process.env.MEDUZA_TEST === '1' && ip === '127.0.0.1') return true;
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return false;
  return true;
}

export class IsapiClient {
  private nc = 0;
  private challenge: Record<string, string> | null = null;
  private readonly base: string;
  // HTTPS is verified like any other TLS connection: a camera with its factory self-signed certificate must either get a
  // proper certificate or be reached over plain HTTP inside the clinic's own network (docs/HIKVISION.md)
  private constructor(private t: IsapiTarget) {
    this.base = `${t.https ? 'https' : 'http'}://${t.host}:${t.port}`;
  }
  /** Checks the address first (see assertCameraAddress), then returns a client bound to it. */
  static async create(t: IsapiTarget): Promise<IsapiClient> {
    assertCameraAddress(t.host);
    return new IsapiClient(t);
  }

  private authHeader(method: string, uri: string): string | null {
    const c = this.challenge;
    if (!c?.nonce) return null;
    const realm = c.realm ?? '';
    const qop = (c.qop ?? '').split(',').map((s) => s.trim()).includes('auth') ? 'auth' : '';
    const ha1 = md5(`${this.t.username}:${realm}:${this.t.password}`);
    const ha2 = md5(`${method}:${uri}`);
    this.nc++;
    const nc = this.nc.toString(16).padStart(8, '0');
    const cnonce = randomBytes(8).toString('hex');
    const response = qop ? md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${c.nonce}:${ha2}`);
    const parts = [`username="${this.t.username}"`, `realm="${realm}"`, `nonce="${c.nonce}"`, `uri="${uri}"`, `response="${response}"`];
    if (c.opaque) parts.push(`opaque="${c.opaque}"`);
    if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    if (c.algorithm) parts.push(`algorithm=${c.algorithm}`);
    return 'Digest ' + parts.join(', ');
  }

  /** One request with Digest authentication (challenge cached; one retry on a fresh 401). */
  async request(method: string, uri: string, body?: Buffer | string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; body: Buffer }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = this.authHeader(method, uri);
      const h: Record<string, string> = { ...headers };
      if (auth) h.Authorization = auth;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(this.base + uri, { method, headers: h, body: body as BodyInit | undefined, signal: ctrl.signal, redirect: 'manual' });
      } catch (e) {
        throw new IsapiError(`Kamera bilan aloqa yo‘q: ${connectionProblem(e)}`);
      } finally { clearTimeout(timer); }
      if (res.status >= 300 && res.status < 400) throw new IsapiError('Kamera boshqa manzilga yo‘naltirmoqchi; bu qo‘llanmaydi', res.status);
      if (res.status === 401) {
        const www = res.headers.get('www-authenticate') ?? '';
        const text = await res.text();
        if (/lockStatus>locked/i.test(text)) throw new IsapiError('Kamera hisobi vaqtincha bloklangan (ko‘p noto‘g‘ri urinish). 30 daqiqadan keyin qayta urinib ko‘ring.', 401, 'LOCKED');
        if (/^Digest/i.test(www) && attempt === 0 && !auth) { this.challenge = parseDigest(www); continue; }
        if (/^Digest/i.test(www) && attempt === 0 && parseDigest(www).stale === 'true') { this.challenge = parseDigest(www); continue; }
        throw new IsapiError('Kamera login yoki parolni qabul qilmadi', 401, 'AUTH');
      }
      return { status: res.status, headers: res.headers, body: await readBounded(res, MAX_RESPONSE) };
    }
    throw new IsapiError('Kamera login yoki parolni qabul qilmadi', 401, 'AUTH');
  }

  /** Opens a long-lived response (alertStream) with Digest auth; the caller reads `res.body` and aborts with the signal. */
  async open(uri: string, signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = this.authHeader('GET', uri);
      const h: Record<string, string> = { Accept: 'multipart/mixed, application/xml, application/json' };
      if (auth) h.Authorization = auth;
      let res: Response;
      try { res = await fetch(this.base + uri, { method: 'GET', headers: h, signal, redirect: 'manual' }); }
      catch (e) { throw new IsapiError(`Kamera bilan aloqa yo‘q: ${connectionProblem(e)}`); }
      if (res.status >= 300 && res.status < 400) throw new IsapiError('Kamera boshqa manzilga yo‘naltirmoqchi; bu qo‘llanmaydi', res.status);
      if (res.status === 401) {
        const www = res.headers.get('www-authenticate') ?? '';
        await res.body?.cancel().catch(() => undefined);
        if (/^Digest/i.test(www) && attempt === 0) { this.challenge = parseDigest(www); continue; }
        throw new IsapiError('Kamera login yoki parolni qabul qilmadi', 401, 'AUTH');
      }
      if (res.status >= 400) throw new IsapiError(`Kamera oqimni ochmadi (${res.status})`, res.status);
      return res;
    }
    throw new IsapiError('Kamera login yoki parolni qabul qilmadi', 401, 'AUTH');
  }

  private async json<T = any>(method: string, uri: string, body?: unknown): Promise<T> {
    const r = await this.request(method, uri, body === undefined ? undefined : JSON.stringify(body), { 'Content-Type': 'application/json', Accept: 'application/json' });
    const text = r.body.toString('utf8');
    let o: any = null;
    try { o = text.trim().startsWith('{') ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (r.status >= 400 || (o && typeof o.statusCode === 'number' && o.statusCode !== 1)) {
      throw new IsapiError(`Kamera rad etdi: ${o?.subStatusCode ?? o?.statusString ?? r.status}`, r.status, o?.subStatusCode);
    }
    return (o ?? {}) as T;
  }

  // ---------- device ----------
  /** Model, firmware, serial from /ISAPI/System/deviceInfo (XML). The first call that proves host + login + password. */
  async deviceInfo(): Promise<{ model: string; firmware: string; serial: string; name: string }> {
    const r = await this.request('GET', '/ISAPI/System/deviceInfo');
    if (r.status >= 400) throw new IsapiError(`Kamera ma’lumot bermadi (${r.status})`, r.status);
    const x = r.body.toString('utf8');
    const get = (n: string) => new RegExp(`<${n}>([^<]*)</${n}>`, 'i').exec(x)?.[1]?.trim() ?? '';
    if (!get('model') && !get('deviceName')) throw new IsapiError('Bu manzilda Hikvision kamerasi topilmadi');
    return { model: get('model'), firmware: `${get('firmwareVersion')} ${get('firmwareReleasedDate')}`.trim(), serial: get('serialNumber'), name: get('deviceName') };
  }

  // ---------- HTTP listening (push) ----------
  /** Points the camera's HTTP host 1 at our push address. XML form (every firmware accepts it; JSON is newer). */
  async setListeningHost(pushUrl: string): Promise<void> {
    const u = new URL(pushUrl);
    const https = u.protocol === 'https:';
    const port = u.port || (https ? '443' : '80');
    const hostIsIp = /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<id>1</id>
<url>${escapeXml(u.pathname)}</url>
<protocolType>${https ? 'HTTPS' : 'HTTP'}</protocolType>
<parameterFormatType>JSON</parameterFormatType>
<addressingFormatType>${hostIsIp ? 'ipaddress' : 'hostname'}</addressingFormatType>
${hostIsIp ? `<ipAddress>${u.hostname}</ipAddress>` : `<hostName>${escapeXml(u.hostname)}</hostName>`}
<portNo>${port}</portNo>
<httpAuthenticationMethod>none</httpAuthenticationMethod>
<uploadImagesDataType>binary</uploadImagesDataType>
<eventMode>all</eventMode>
</HttpHostNotification>`;
    const r = await this.request('PUT', '/ISAPI/Event/notification/httpHosts/1', xml, { 'Content-Type': 'application/xml' });
    if (r.status >= 400 || /<statusCode>(?![01]<)/.test(r.body.toString('utf8')) && !/<statusString>OK</i.test(r.body.toString('utf8'))) {
      throw new IsapiError(`Kamera listening sozlamasini qabul qilmadi: ${statusText(r.body)}`, r.status);
    }
  }

  /** Asks the camera to send a test notification to host 1; the camera reports whether it reached us. */
  async testListeningHost(): Promise<{ ok: boolean; detail: string }> {
    const r = await this.request('POST', '/ISAPI/Event/notification/httpHosts/1/test');
    const text = r.body.toString('utf8');
    const err = /<errorDescription>([^<]*)</i.exec(text)?.[1];
    const ok = r.status < 400 && (/<statusString>OK</i.test(text) || /<statusCode>1</.test(text) || /"statusCode":\s*1/.test(text));
    return { ok, detail: ok ? 'OK' : err || statusText(r.body) || `HTTP ${r.status}` };
  }

  // ---------- face library ----------
  /** Lists the camera's face libraries (JSON on new firmware, XML on older). */
  async listLibraries(): Promise<{ id: string; type: string; name: string }[]> {
    const r = await this.request('GET', '/ISAPI/Intelligent/FDLib?format=json', undefined, { Accept: 'application/json' });
    const text = r.body.toString('utf8').trim();
    if (text.startsWith('{')) {
      const o = JSON.parse(text);
      if (o.statusCode !== undefined && o.statusCode !== 1) throw new IsapiError(`Yuz kutubxonasi ro‘yxati olinmadi: ${o.subStatusCode ?? o.statusString}`);
      return (Array.isArray(o.FDLib) ? o.FDLib : []).map((l: any) => ({ id: String(l.FDID ?? ''), type: String(l.faceLibType ?? ''), name: String(l.name ?? '') }));
    }
    // XML FDLibBaseCfgList
    const x = (await this.request('GET', '/ISAPI/Intelligent/FDLib')).body.toString('utf8');
    return [...x.matchAll(/<FDLibBaseCfg>([\s\S]*?)<\/FDLibBaseCfg>/g)].map((m) => ({
      id: /<FDID>([^<]*)</.exec(m[1])?.[1] ?? '', type: /<faceLibType>([^<]*)</.exec(m[1])?.[1] ?? 'blackFD', name: /<name>([^<]*)</.exec(m[1])?.[1] ?? '',
    }));
  }

  /** The library our codes live in: an existing one named like ours, else the first list-type library, else a new one. */
  async ensureLibrary(name = 'Med.uz.ai'): Promise<string> {
    const libs = await this.listLibraries();
    const ours = libs.find((l) => l.name === name) ?? libs.find((l) => l.type === 'blackFD' || l.type === 'blackID') ?? libs[0];
    if (ours?.id) return ours.id;
    try {
      const o = await this.json<any>('POST', '/ISAPI/Intelligent/FDLib?format=json', { faceLibType: 'blackFD', name, customInfo: 'Med.uz.ai' });
      if (o.FDID) return String(o.FDID);
    } catch (e) {
      if (!(e instanceof IsapiError) || e.status === 401) throw e;
    }
    // older firmware: XML CreateFDLibList
    const xml = `<CreateFDLibList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><CreateFDLib><id>1</id><name>${escapeXml(name)}</name><thresholdValue>80</thresholdValue><customFaceLibID>meduzai</customFaceLibID></CreateFDLib></CreateFDLibList>`;
    const r = await this.request('POST', '/ISAPI/Intelligent/FDLib', xml, { 'Content-Type': 'application/xml' });
    const id = /<FDID>([^<]*)</.exec(r.body.toString('utf8'))?.[1];
    if (!id) throw new IsapiError(`Kamerada yuz kutubxonasi yaratilmadi: ${statusText(r.body)}`, r.status);
    return id;
  }

  /**
   * Puts one face into the library under our code. Tries the JSON FaceDataRecord form (face recognition servers,
   * terminals, newer cameras) and falls back to the XML pictureUpload form (DeepinView cameras). The code goes into
   * every field a camera may echo back (certificateNumber, customHumanID, name), so the event carries it whatever
   * the firmware does. Returns the camera's record id for a later delete.
   */
  async addFace(fdid: string, code: string, jpeg: Buffer, displayName?: string): Promise<string> {
    if (!(jpeg[0] === 0xff && jpeg[1] === 0xd8)) throw new AppError(422, 'VALIDATION', 'Rasm JPEG bo‘lishi kerak', { photo: 'JPEG rasm yuklang' });
    if (jpeg.length > 300 * 1024) throw new AppError(422, 'VALIDATION', 'Rasm 300 KB dan katta', { photo: 'Rasm hajmi 300 KB gacha bo‘lsin' });
    const name = displayName ? `${code} ${displayName}`.slice(0, 32) : code;
    const b = 'MeduzaBoundary' + randomBytes(6).toString('hex');
    // 1) JSON FaceDataRecord, multipart: part «FaceDataRecord» + part «img»
    const rec = JSON.stringify({ faceLibType: 'blackFD', FDID: fdid, FPID: code, name, certificateType: 'officerID', certificateNumber: code, customHumanID: code });
    const body1 = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="FaceDataRecord"\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(rec)}\r\n\r\n${rec}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="img"; filename="${code}.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const r1 = await this.request('POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', body1, { 'Content-Type': `multipart/form-data; boundary=${b}` });
    const t1 = r1.body.toString('utf8');
    let o1: any = null; try { o1 = t1.trim().startsWith('{') ? JSON.parse(t1) : null; } catch { /* */ }
    if (r1.status < 400 && o1 && (o1.statusCode === 1 || o1.statusCode === undefined)) return String(o1.FPID ?? code);
    if (o1?.subStatusCode && /exist|duplicate/i.test(String(o1.subStatusCode))) throw new IsapiError('Bu kod kamerada allaqachon bor. Avval eskisini o‘chiring.', r1.status, 'EXISTS');
    if (r1.status === 401 || r1.status === 403) throw new IsapiError('Kamera yuz yuklashga ruxsat bermadi (login huquqi)', r1.status, 'AUTH');
    // 2) XML pictureUpload (camera firmware): part «PictureUploadData» (text/xml) + the JPEG
    const xml = `<PictureUploadData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><FDID>${escapeXml(fdid)}</FDID><FaceAppendData><name>${escapeXml(name)}</name><certificateType>officerID</certificateType><certificateNumber>${escapeXml(code)}</certificateNumber><customHumanID>${escapeXml(code)}</customHumanID></FaceAppendData></PictureUploadData>`;
    const body2 = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="PictureUploadData"\r\nContent-Type: text/xml\r\nContent-Length: ${Buffer.byteLength(xml)}\r\n\r\n${xml}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="importImage"; filename="${code}.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    for (const uri of [`/ISAPI/Intelligent/FDLib/pictureUpload?type=concurrent`, `/ISAPI/Intelligent/pictureUpload`]) {
      const r2 = await this.request('POST', uri, body2, { 'Content-Type': `multipart/form-data; boundary=${b}` });
      const t2 = r2.body.toString('utf8');
      if (r2.status < 400 && (/<statusString>OK</i.test(t2) || /<statusCode>1</.test(t2) || /"statusCode":\s*1/.test(t2))) {
        return /<PID>([^<]*)</.exec(t2)?.[1] ?? /"PID":\s*"([^"]+)"/.exec(t2)?.[1] ?? code;
      }
      if (r2.status === 404 || /notSupport|invalidOperation/i.test(t2)) continue;
      const why = statusText(r2.body) || `HTTP ${r2.status}`;
      if (/face|picture|quality|detect/i.test(why)) throw new IsapiError(`Kamera rasmda yuzni aniqlay olmadi (${why}). Yuz to‘g‘ridan, yaxshi yorug‘likda, 20–300 KB JPEG bo‘lsin.`, r2.status, 'FACE_QUALITY');
      throw new IsapiError(`Kamera rasmni qabul qilmadi: ${why}`, r2.status);
    }
    throw new IsapiError(`Bu kamera proshivkasi ISAPI orqali yuz yuklashni qo‘llamaydi (${o1?.subStatusCode ?? o1?.statusString ?? r1.status}). Yuzni kameraning veb-sahifasida qo‘shing (ID No. = ${code}).`, r1.status, 'UNSUPPORTED');
  }

  /** Removes a face record by our code (both forms, best effort: a missing record is fine). */
  async deleteFace(fdid: string, code: string, remoteId?: string | null): Promise<void> {
    // JSON: delete by FPID
    try {
      const o = await this.json<any>('PUT', `/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=${encodeURIComponent(fdid)}&faceLibType=blackFD`, { FPID: [{ value: remoteId || code }] });
      if (o && (o.statusCode === 1 || o.statusCode === undefined)) return;
    } catch (e) { if (e instanceof IsapiError && e.status === 401) throw e; }
    // XML: delete the picture record by PID
    const pid = remoteId || code;
    const r = await this.request('DELETE', `/ISAPI/Intelligent/FDLib/${encodeURIComponent(fdid)}/picture/${encodeURIComponent(pid)}`);
    if (r.status >= 400 && r.status !== 404) throw new IsapiError(`Kameradan yuz o‘chirilmadi: ${statusText(r.body) || r.status}`, r.status);
  }

  /** Face comparison on channel 1 against our library (best effort; some firmware keeps this in the web UI only). */
  async enableComparison(fdid: string, threshold = 80): Promise<boolean> {
    const xml = `<FaceContrast version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><id>1</id><enable>true</enable><faceContrastType>faceContrast</faceContrastType><thresholdValue>${threshold}</thresholdValue><FDLibList><FDLib><id>1</id><FDID>${escapeXml(fdid)}</FDID></FDLib></FDLibList></FaceContrast>`;
    const r = await this.request('PUT', '/ISAPI/Intelligent/channels/1/faceContrast', xml, { 'Content-Type': 'application/xml' });
    return r.status < 400 && !/<statusCode>(?![01]<)/.test(r.body.toString('utf8'));
  }
}

/** A short, non-technical reason: no socket error codes (they would tell a caller which ports answer). */
function connectionProblem(e: unknown): string {
  const cause = String((e as any)?.cause?.code ?? (e as any)?.cause?.message ?? '');
  if ((e as Error)?.name === 'AbortError') return 'javob kutish vaqti tugadi';
  if (/CERT|certificate|self.signed|altname/i.test(cause)) return 'HTTPS sertifikati tasdiqlanmadi (kamerada ishonchli sertifikat o‘rnating yoki klinika tarmog‘ida HTTP ishlating)';
  return 'kamera javob bermadi (manzil, port va tarmoqni tekshiring)';
}
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function statusText(body: Buffer): string {
  const t = body.toString('utf8');
  return /<subStatusCode>([^<]*)</i.exec(t)?.[1] || /<statusString>([^<]*)</i.exec(t)?.[1] || /"subStatusCode":\s*"([^"]+)"/.exec(t)?.[1] || /"statusString":\s*"([^"]+)"/.exec(t)?.[1] || '';
}
