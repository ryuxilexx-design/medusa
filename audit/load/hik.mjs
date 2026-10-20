// Camera push burst at a fixed arrival rate with real ISAPI payload shapes (from apps/api/test/cameras.test.mjs and tools/hik-replay.mjs).
// Usage: node hik.mjs burst [rate=100] [seconds=60] | node hik.mjs big
import { appendFileSync } from 'node:fs';
import { BASE, OUT, req } from './lib.mjs';

const CAM = BASE.replace('/api/v1', '') + '/api/v1/hik/lt-load-camera-token-c1'; // attendance + patient arrival + counting
const SEC = BASE.replace('/api/v1', '') + '/api/v1/hik/lt-load-camera-token-c2'; // security
const tash = (ms) => new Date(ms + 5 * 3600_000).toISOString().slice(0, 19) + '+05:00';

const PC_RANGE = (start, end, enter, exit) => `<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<ipAddress>10.18.98.66</ipAddress><macAddress>98:df:82:30:1a:a0</macAddress><channelID>1</channelID>
<dateTime>${end}</dateTime><eventType>PeopleCounting</eventType><eventState>active</eventState><eventDescription>peopleCounting alarm</eventDescription>
<peopleCounting><statisticalMethods>timeRange</statisticalMethods><TimeRange><startTime>${start}</startTime><endTime>${end}</endTime></TimeRange>
<enter>${enter}</enter><exit>${exit}</exit><pass>0</pass><duplicatePeople>0</duplicatePeople></peopleCounting></EventNotificationAlert>`;
const FIELD = (time) => `<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<ipAddress>1.0.0.255</ipAddress><portNo>80</portNo><protocol>HTTP</protocol><macAddress>ac:b9:2f:49:44:75</macAddress><channelID>1</channelID>
<dateTime>${time}</dateTime><activePostCount>1</activePostCount><eventType>fielddetection</eventType><eventState>active</eventState>
<eventDescription>fielddetection alarm</eventDescription><DetectionRegionList><DetectionRegionEntry><regionID>3</regionID><sensitivityLevel>50</sensitivityLevel>
<detectionTarget>human</detectionTarget></DetectionRegionEntry></DetectionRegionList><channelName>COUR NORD</channelName></EventNotificationAlert>`;
function faceMatch(code, time, similarity = 0.94, pictureBytes = 11) {
  const json = JSON.stringify({ ipAddress: '192.168.1.64', portNo: 80, protocol: 'HTTP', channelID: 1, dateTime: time, activePostCount: 1, eventType: 'alarmResult', eventState: 'active',
    eventDescription: 'alarmResult', alarmResult: [{ targetAttrs: { deviceChannel: 1, deviceName: 'IP CAMERA', faceTime: time }, faces: [{ faceRect: { height: 0.165, width: 0.093, x: 0.4, y: 0.577 },
      identify: [{ maxsimilarity: similarity, candidate: [{ human_data: [{ bkg_picurl: 'http://192.168.1.64/FDLib?FDID=1&pId=2', similarity }],
        reserve_field: { name: 'Xodim', certificateType: 'officerID', certificateNumber: code }, similarity, listType: 'whiteList' }] }] }] }], URLCertificationType: 'digest' });
  const b = 'MIME_boundary'; const pic = Buffer.alloc(pictureBytes, 0x41);
  return { type: `multipart/form-data; boundary=${b}`, body: Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="alarmResult"\r\nContent-Type: application/json; charset="UTF-8"\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="facePicture"; filename="facePicture.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${pic.length}\r\n\r\n`), pic,
    Buffer.from(`\r\n--${b}--\r\n`)]) };
}

const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
const mode = process.argv[2] || 'burst';
if (mode === 'burst') {
  const rate = Number(process.argv[3] || 100), secs = Number(process.argv[4] || 60);
  const base = Date.parse('2026-01-01T03:00:00Z') + Math.floor(Math.random() * 350_000) * 60_000; // unique minutes per run (dedupe key = code+minute)
  const lat = []; const st = {}; let stored = 0; const inflight = []; let maxInflight = 0, cur = 0;
  const t0 = performance.now();
  for (let i = 0; i < rate * secs; i++) {
    const due = t0 + (i * 1000) / rate; const wait = due - performance.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const minute = base + i * 60_000;
    let url = CAM, p;
    if (i % 10 < 5) p = faceMatch(`S-${101 + (i % 80)}`, tash(minute));
    else if (i % 10 < 8) p = { type: 'application/xml', body: PC_RANGE(tash(minute - 60_000), tash(minute), 1 + (i % 3), i % 2) };
    else { url = SEC; p = { type: 'application/xml', body: FIELD(tash(minute)) }; }
    cur++; maxInflight = Math.max(maxInflight, cur);
    inflight.push(req(url, { method: 'POST', body: p.body, headers: { 'content-type': p.type }, timeoutMs: 30_000 }).then((r) => {
      cur--; lat.push(r.ms); st[r.status || r.error] = (st[r.status || r.error] || 0) + 1; stored += r.json?.stored ?? 0; }));
  }
  await Promise.all(inflight);
  const wall = (performance.now() - t0) / 1000; lat.sort((a, b) => a - b);
  const s = { name: 'hik.burst', target_rps: rate, n: lat.length, wall_s: +wall.toFixed(1), achieved_rps: +(lat.length / wall).toFixed(1), p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)),
    p99: Math.round(pct(lat, 99)), max: Math.round(lat.at(-1)), statuses: st, stored, max_inflight: maxInflight };
  console.log(JSON.stringify(s)); if (OUT) appendFileSync(OUT, JSON.stringify(s) + '\n');
} else if (mode === 'big') {
  // bodies just under / over the 6 MB limit, then 20 near-limit bodies in parallel
  for (const mb of [5.9, 6.5]) {
    const p = faceMatch('S-101', tash(Date.now()), 0.94, Math.floor(mb * 1024 * 1024));
    const r = await req(CAM, { method: 'POST', body: p.body, headers: { 'content-type': p.type }, timeoutMs: 60_000 });
    console.log(JSON.stringify({ name: `hik.big.${mb}MB`, status: r.status, ms: Math.round(r.ms), err: r.error, body: r.json }));
  }
  const ps = Array.from({ length: 20 }, (_, i) => faceMatch(`S-${110 + i}`, tash(Date.parse('2026-01-01T01:00:00Z') + i * 60_000 + Math.floor(Math.random() * 6000) * 3_600_000), 0.94, 5.9 * 1024 * 1024));
  const t0 = performance.now();
  const rs = await Promise.all(ps.map((p) => req(CAM, { method: 'POST', body: p.body, headers: { 'content-type': p.type }, timeoutMs: 120_000 })));
  console.log(JSON.stringify({ name: 'hik.big.20x5.9MB.parallel', statuses: rs.map((r) => r.status || r.error).join(','), max_ms: Math.round(Math.max(...rs.map((r) => r.ms))), wall_ms: Math.round(performance.now() - t0) }));
}
