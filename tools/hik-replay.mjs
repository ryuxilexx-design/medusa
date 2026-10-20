#!/usr/bin/env node
// Sends realistic Hikvision ISAPI event notifications (the same XML / JSON / multipart a DeepinView camera pushes in
// «HTTP Listening» mode) to a Med.uz.ai camera push address. Use it to test a server end to end without a camera.
//
//   node tools/hik-replay.mjs <push-url> <scenario> [options]
//
//   push-url   the address shown once when the camera was added, e.g. https://klinika.example.uz/api/v1/hik/AbC…
//   scenario   heartbeat | staff | patient | counting | counting-rt | night | all
//   --codes S-1,S-2     staff codes for «staff» (default S-1,S-2,S-3)
//   --code P-1001       patient code for «patient»
//   --time 2026-10-18T08:47:00+05:00   event time (default: now, Tashkent offset)
//   --dry               print the requests instead of sending them
//
// Payload shapes follow docs/HIKVISION_ISAPI_RESEARCH.md (public ISAPI guide samples and real-device captures).
// The face message carries a tiny placeholder instead of a photo: the server drops picture parts unread anyway.
// Never point this at the Railway demo with real people's codes; it is for test servers and synthetic codes.

const [url, scenario = 'all', ...rest] = process.argv.slice(2);
if (!url || !/^https?:\/\/.+\/hik\/[A-Za-z0-9_-]{20,64}$/.test(url)) {
  console.error('Foydalanish: node tools/hik-replay.mjs <push-url .../api/v1/hik/<token>> <heartbeat|staff|patient|counting|counting-rt|night|all> [--codes S-1,S-2] [--code P-1001] [--time ISO] [--dry]');
  process.exit(1);
}
const opt = (name, def) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : def; };
const dry = rest.includes('--dry');

/** ISO time with the Tashkent offset, as a camera set to UTC+05:00 writes it. */
const tashkent = (d) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 19) + '+05:00';
const base = opt('time') ? new Date(opt('time')) : new Date();
if (Number.isNaN(base.getTime())) { console.error('--time noto‘g‘ri'); process.exit(1); }
const at = (minutesFromBase = 0) => tashkent(new Date(base.getTime() + minutesFromBase * 60_000));

const NS = 'http://www.hikvision.com/ver20/XMLSchema';
const envelope = (time, type, body = '', extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="${NS}">
<ipAddress>192.168.1.64</ipAddress><portNo>80</portNo><protocol>HTTP</protocol><macAddress>84:9a:40:ec:f1:6d</macAddress>
<channelID>1</channelID><dateTime>${time}</dateTime><activePostCount>1</activePostCount>
<eventType>${type}</eventType><eventState>${type === 'videoloss' ? 'inactive' : 'active'}</eventState><eventDescription>${type} alarm</eventDescription>
${body}<channelName>Camera 01</channelName>${extra}
</EventNotificationAlert>`;

const heartbeat = () => ({ name: 'heartbeat (videoloss inactive)', type: 'application/xml; charset="UTF-8"', body: envelope(at(), 'videoloss') });

/** Face comparison against the camera's own library (alarmResult), multipart like HTTP listening sends it. */
function faceMatch(code, time, similarity = 0.94) {
  const json = JSON.stringify({
    ipAddress: '192.168.1.64', portNo: 80, protocol: 'HTTP', channelID: 1, dateTime: time, activePostCount: 1,
    eventType: 'alarmResult', eventState: 'active', eventDescription: 'alarmResult',
    alarmResult: [{
      targetAttrs: { deviceChannel: 1, deviceName: 'IP CAMERA', faceTime: time },
      faces: [{
        faceRect: { height: 0.165, width: 0.093, x: 0.4, y: 0.577 },
        identify: [{ maxsimilarity: similarity, candidate: [{
          human_data: [{ bkg_picurl: 'http://192.168.1.64/FDLib?FDID=1&pId=2', similarity }],
          // the clinic typed our code into «ID No.» when enrolling the face on the camera
          reserve_field: { name: 'Xodim', certificateType: 'officerID', certificateNumber: code },
          similarity, listType: 'whiteList',
        }] }],
      }],
    }],
    URLCertificationType: 'digest',
  });
  const b = 'MIME_boundary';
  const placeholder = Buffer.from('not-a-photo');
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="alarmResult"\r\nContent-Type: application/json; charset="UTF-8"\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="facePicture"; filename="facePicture.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${placeholder.length}\r\n\r\n`), placeholder,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return { name: `face match ${code} at ${time}`, type: `multipart/form-data; boundary=${b}`, body };
}

/** People counting, «time range» mode: entries/exits for one interval. */
const countingRange = (start, end, enter, exit) => ({
  name: `people counting ${start.slice(11, 16)}–${end.slice(11, 16)}: +${enter} / -${exit}`, type: 'application/xml',
  body: envelope(end, 'PeopleCounting', `<peopleCounting><statisticalMethods>timeRange</statisticalMethods><TimeRange><startTime>${start}</startTime><endTime>${end}</endTime></TimeRange>
<enter>${enter}</enter><exit>${exit}</exit><pass>0</pass><duplicatePeople>0</duplicatePeople></peopleCounting>`),
});
/** People counting, «real time» mode: running totals since the camera's daily reset. */
const countingRt = (time, enter, exit) => ({
  name: `people counting (running total) ${time.slice(11, 16)}: ${enter} / ${exit}`, type: 'application/xml',
  body: envelope(time, 'PeopleCounting', `<peopleCounting><statisticalMethods>realTime</statisticalMethods><RealTime><time>${time}</time></RealTime>
<enter>${enter}</enter><exit>${exit}</exit><regionsID>1</regionsID></peopleCounting>`),
});
/** Intrusion (fielddetection) with a human target, as a DeepinView camera reports it. */
const intrusion = (time, type = 'fielddetection') => ({
  name: `${type} (human) at ${time}`, type: 'application/xml',
  body: envelope(time, type, `<DetectionRegionList><DetectionRegionEntry><regionID>1</regionID><sensitivityLevel>50</sensitivityLevel>
<detectionTarget>human</detectionTarget><TargetRect><X>0.6</X><Y>0.21</Y><width>0.13</width><height>0.5</height></TargetRect></DetectionRegionEntry></DetectionRegionList>`,
    '<detectionPictureTransType>binary</detectionPictureTransType><detectionPicturesNumber>0</detectionPicturesNumber><isDataRetransmission>false</isDataRetransmission>'),
});

const SCENARIOS = {
  heartbeat: () => [heartbeat()],
  staff: () => (opt('codes', 'S-1,S-2,S-3')).split(',').map((c, i) => faceMatch(c.trim(), at(i * 3), 0.9 + (i % 5) / 100)),
  patient: () => [faceMatch(opt('code', 'P-1010'), at(), 0.96)],
  counting: () => [0, 1, 2].map((h) => countingRange(at(-60 * (3 - h)), at(-60 * (2 - h)), 12 + h * 5, 9 + h * 4)),
  'counting-rt': () => [countingRt(at(-10), 40, 22), countingRt(at(-5), 47, 25), countingRt(at(), 52, 31)],
  night: () => [intrusion(at()), intrusion(at(2), 'linedetection'), intrusion(at(4), 'regionEntrance')],
};
SCENARIOS.all = () => [...SCENARIOS.heartbeat(), ...SCENARIOS.staff(), ...SCENARIOS.patient(), ...SCENARIOS.counting(), ...SCENARIOS.night()];
if (!SCENARIOS[scenario]) { console.error(`Noma’lum ssenariy: ${scenario}`); process.exit(1); }

let failed = 0;
for (const r of SCENARIOS[scenario]()) {
  if (dry) { console.log(`--- ${r.name}\nContent-Type: ${r.type}\n${Buffer.isBuffer(r.body) ? r.body.toString('latin1') : r.body}\n`); continue; }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': r.type }, body: r.body });
    const text = await res.text();
    console.log(`${res.ok ? '✓' : '✗'} ${res.status} ${r.name} → ${text.slice(0, 120)}`);
    if (!res.ok) failed++;
  } catch (e) { console.log(`✗ ${r.name}: ${e.message}`); failed++; }
}
process.exit(failed ? 1 : 0);
