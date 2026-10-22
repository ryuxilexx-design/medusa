// A fake Hikvision camera for tests: HTTP Digest auth (qop=auth), /ISAPI/System/deviceInfo, HTTP listening host
// (GET/PUT /httpHosts/1, POST /httpHosts/1/test sends a real heartbeat to the configured URL), face libraries
// (JSON list/create), face records (JSON FaceDataRecord multipart, or the XML pictureUpload form when
// `firmware: 'xml'`), FDSearch/Delete, faceContrast, and alertStream (multipart/mixed: a heartbeat, an alarmResult
// for a chosen code, an intrusion with a JPEG part). Shapes follow docs/HIKVISION_ISAPI_RESEARCH.md.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const md5 = (s) => createHash('md5').update(s).digest('hex');

export function startFakeCamera({ username = 'admin', password = 'Clinic123', firmware = 'json', model = 'iDS-2CD7146G0-IZS' } = {}) {
  const state = { httpHost: null, libs: [{ FDID: '1', faceLibType: 'blackFD', name: 'Default' }], faces: [], requests: [], streamEvents: [], pushes: 0, bad: 0 };
  const realm = 'DS-2CD7146G0';
  const nonce = () => randomBytes(8).toString('hex');
  let currentNonce = nonce();

  const unauthorized = (res, stale = false) => {
    res.writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${realm}", nonce="${currentNonce}"${stale ? ', stale="true"' : ''}`, 'Content-Type': 'text/plain' });
    res.end(state.bad >= 5 ? '<lockStatus>locked</lockStatus>' : '');
  };
  const checkDigest = (req) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Digest ')) return false;
    const f = {}; for (const m of h.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) f[m[1]] = m[2] ?? m[3];
    if (f.username !== username || f.nonce !== currentNonce) return false;
    const ha1 = md5(`${username}:${realm}:${password}`), ha2 = md5(`${req.method}:${f.uri}`);
    const expect = f.qop ? md5(`${ha1}:${f.nonce}:${f.nc}:${f.cnonce}:${f.qop}:${ha2}`) : md5(`${ha1}:${f.nonce}:${ha2}`);
    return expect === f.response;
  };
  const xml = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/xml' }); res.end(body); };
  const json = (res, o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const okXml = '<?xml version="1.0"?><ResponseStatus version="2.0"><statusCode>1</statusCode><statusString>OK</statusString><subStatusCode>ok</subStatusCode></ResponseStatus>';
  const parts = (buf, ct) => {
    const b = /boundary=([^;]+)/.exec(ct)?.[1]; if (!b) return [];
    return buf.toString('latin1').split('--' + b).map((c) => { const i = c.indexOf('\r\n\r\n'); if (i < 0) return null; const head = c.slice(0, i); const body = c.slice(i + 4).replace(/\r\n$/, ''); return { name: /name="([^"]+)"/.exec(head)?.[1], type: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1], body: Buffer.from(body, 'latin1') }; }).filter(Boolean);
  };

  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: !!req.headers.authorization });
    if (!checkDigest(req)) { if (req.headers.authorization) state.bad++; return unauthorized(res); }
    state.bad = 0;
    const p = url.pathname;
    if (p === '/ISAPI/System/deviceInfo') return xml(res, `<DeviceInfo version="2.0"><deviceName>Lobby cam</deviceName><deviceID>abc</deviceID><model>${model}</model><serialNumber>${model}20240101AAWR12345678</serialNumber><firmwareVersion>V5.7.12</firmwareVersion><firmwareReleasedDate>build 240415</firmwareReleasedDate></DeviceInfo>`);
    if (p === '/ISAPI/Event/notification/httpHosts/1' && req.method === 'PUT') {
      const x = body.toString();
      state.httpHost = { url: /<url>([^<]*)</.exec(x)?.[1], protocol: /<protocolType>([^<]*)</.exec(x)?.[1], host: /<hostName>([^<]*)</.exec(x)?.[1] ?? /<ipAddress>([^<]*)</.exec(x)?.[1], port: Number(/<portNo>([^<]*)</.exec(x)?.[1]), format: /<parameterFormatType>([^<]*)</.exec(x)?.[1] };
      return xml(res, okXml);
    }
    if (p === '/ISAPI/Event/notification/httpHosts/1' && req.method === 'GET') return xml(res, `<HttpHostNotification><id>1</id><url>${state.httpHost?.url ?? ''}</url></HttpHostNotification>`);
    if (p === '/ISAPI/Event/notification/httpHosts/1/test') {
      if (!state.httpHost) return xml(res, '<HttpHostTestResult><errorDescription>no host</errorDescription></HttpHostTestResult>', 400);
      // the camera really calls the listener, as a device does (a heartbeat)
      const target = `${state.httpHost.protocol.toLowerCase()}://${state.httpHost.host}:${state.httpHost.port}${state.httpHost.url}`;
      try {
        const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/xml' }, body: '<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><ipAddress>10.0.0.9</ipAddress><channelID>1</channelID><dateTime>2026-10-18T07:00:00+05:00</dateTime><eventType>videoloss</eventType><eventState>inactive</eventState></EventNotificationAlert>' });
        state.pushes++;
        return r.ok ? xml(res, okXml) : xml(res, `<HttpHostTestResult><errorDescription>HTTP ${r.status}</errorDescription></HttpHostTestResult>`, 400);
      } catch (e) { return xml(res, `<HttpHostTestResult><errorDescription>${e.message}</errorDescription></HttpHostTestResult>`, 400); }
    }
    if (p === '/ISAPI/Intelligent/FDLib' && req.method === 'GET' && url.searchParams.get('format') === 'json') return json(res, { requestURL: req.url, statusCode: 1, statusString: 'OK', subStatusCode: 'ok', FDLib: state.libs });
    if (p === '/ISAPI/Intelligent/FDLib' && req.method === 'POST') {
      const o = JSON.parse(body.toString()); const lib = { FDID: String(state.libs.length + 1), faceLibType: o.faceLibType, name: o.name }; state.libs.push(lib);
      return json(res, { statusCode: 1, statusString: 'OK', subStatusCode: 'ok', FDID: lib.FDID });
    }
    if (p === '/ISAPI/Intelligent/channels/1/faceContrast' && req.method === 'PUT') { state.faceContrast = body.toString(); return xml(res, okXml); }
    if (p === '/ISAPI/Intelligent/FDLib/FaceDataRecord' && req.method === 'POST') {
      if (firmware === 'xml') return json(res, { statusCode: 4, statusString: 'Invalid Operation', subStatusCode: 'notSupport' }, 400);
      const ps = parts(body, req.headers['content-type'] || '');
      const rec = JSON.parse(ps[0].body.toString()); const img = ps[1];
      if (ps[0].name !== 'FaceDataRecord' || !img || !/image\/jpeg/.test(img.type)) return json(res, { statusCode: 4, subStatusCode: 'badParameters' }, 400);
      if (!(img.body[0] === 0xff && img.body[1] === 0xd8)) return json(res, { statusCode: 6, subStatusCode: 'faceDetectFailed' }, 400);
      if (state.faces.some((f) => f.FPID === rec.FPID)) return json(res, { statusCode: 6, subStatusCode: 'faceRecordExist' }, 400);
      state.faces.push({ FPID: rec.FPID, name: rec.name, FDID: rec.FDID, certificateNumber: rec.certificateNumber, customHumanID: rec.customHumanID, bytes: img.body.length });
      return json(res, { statusCode: 1, statusString: 'OK', subStatusCode: 'ok', FPID: rec.FPID });
    }
    if ((p === '/ISAPI/Intelligent/FDLib/pictureUpload' || p === '/ISAPI/Intelligent/pictureUpload') && req.method === 'POST') {
      if (firmware !== 'xml') return xml(res, '<ResponseStatus><statusCode>4</statusCode><subStatusCode>notSupport</subStatusCode></ResponseStatus>', 404);
      const ps = parts(body, req.headers['content-type'] || '');
      const x = ps[0].body.toString(); const code = /<customHumanID>([^<]*)</.exec(x)?.[1];
      const pid = 'PID' + (state.faces.length + 1);
      state.faces.push({ FPID: pid, name: /<name>([^<]*)</.exec(x)?.[1], FDID: /<FDID>([^<]*)</.exec(x)?.[1], certificateNumber: /<certificateNumber>([^<]*)</.exec(x)?.[1], customHumanID: code, bytes: ps[1].body.length });
      return xml(res, `<ResponseStatus><statusCode>1</statusCode><statusString>OK</statusString><PID>${pid}</PID></ResponseStatus>`);
    }
    if (p === '/ISAPI/Intelligent/FDLib/FDSearch/Delete' && req.method === 'PUT') {
      if (firmware === 'xml') return json(res, { statusCode: 4, subStatusCode: 'notSupport' }, 400);
      const ids = (JSON.parse(body.toString()).FPID || []).map((x) => x.value); state.faces = state.faces.filter((f) => !ids.includes(f.FPID));
      return json(res, { statusCode: 1, statusString: 'OK', subStatusCode: 'ok' });
    }
    const del = /^\/ISAPI\/Intelligent\/FDLib\/([^/]+)\/picture\/([^/]+)$/.exec(p);
    if (del && req.method === 'DELETE') { const before = state.faces.length; state.faces = state.faces.filter((f) => f.FPID !== decodeURIComponent(del[2])); return before === state.faces.length ? xml(res, okXml, 404) : xml(res, okXml); }
    if (p === '/ISAPI/Event/notification/alertStream') {
      const b = 'boundary';
      res.writeHead(200, { 'Content-Type': `multipart/mixed; boundary=${b}` });
      const part = (type, data) => { const buf = Buffer.isBuffer(data) ? data : Buffer.from(data); res.write(Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: ${type}\r\nContent-Length: ${buf.length}\r\n\r\n`), buf, Buffer.from('\r\n')])); };
      part('application/xml', '<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><channelID>1</channelID><dateTime>2026-10-18T07:10:00+05:00</dateTime><eventType>videoloss</eventType><eventState>inactive</eventState></EventNotificationAlert>');
      for (const ev of state.streamEvents) { if (ev.type) part(ev.type, ev.body); else { part('application/json', ev.json); } if (ev.picture) part('image/jpeg', ev.picture); }
      const timer = setInterval(() => { if (res.destroyed || res.writableEnded) return clearInterval(timer); part('application/xml', '<EventNotificationAlert><eventType>videoloss</eventType><eventState>inactive</eventState></EventNotificationAlert>'); }, 1000);
      timer.unref();
      req.on('close', () => clearInterval(timer)); res.on('close', () => clearInterval(timer));
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { server.unref(); resolve({ server, state, port: server.address().port, host: '127.0.0.1', close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) }); }));
}

/** An alarmResult (face comparison) as DeepinView firmware sends it, for the stream. */
export const alarmResultJson = (code, time, sim = 0.95) => JSON.stringify({
  ipAddress: '10.0.0.9', portNo: 80, protocol: 'HTTP', channelID: 1, dateTime: time, activePostCount: 1, eventType: 'alarmResult', eventState: 'active', eventDescription: 'alarmResult',
  alarmResult: [{ targetAttrs: { deviceChannel: 1, deviceName: 'IP CAMERA', faceTime: time }, faces: [{ faceRect: { height: 0.16, width: 0.09, x: 0.4, y: 0.57 },
    identify: [{ maxsimilarity: sim, candidate: [{ blacklist_id: 'tg', human_data: [{ bkg_picurl: 'http://10.0.0.9/FDLib?FDID=1&pId=1', similarity: sim }],
      reserve_field: { name: `${code} Xodim`, certificateType: 'officerID', certificateNumber: code, customHumanID: code }, similarity: sim, listType: 'blackList' }] }] }] }],
  URLCertificationType: 'digest',
});
export const intrusionXml = (time) => `<?xml version="1.0" encoding="UTF-8"?><EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema"><ipAddress>10.0.0.9</ipAddress><channelID>1</channelID><dateTime>${time}</dateTime><activePostCount>1</activePostCount><eventType>fielddetection</eventType><eventState>active</eventState><eventDescription>fielddetection alarm</eventDescription><DetectionRegionList><DetectionRegionEntry><regionID>1</regionID><detectionTarget>human</detectionTarget></DetectionRegionEntry></DetectionRegionList><detectionPicturesNumber>1</detectionPicturesNumber></EventNotificationAlert>`;
