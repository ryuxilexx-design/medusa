#!/usr/bin/env node
// Draws the demo's camera «alert snapshots»: synthetic CCTV-style frames (no real people, no real places) that the
// seed attaches to its security alerts. Scenes are drawn as SVG (walls, doors, a silhouette, the camera's own
// overlay: zone, target box, time, channel name) and rendered to JPEG with the system Chrome.
//
//   node tools/gen-snapshots.mjs            → database/seed/snapshots/*.jpg (640×360, ~30–60 KB each)
//
// The files are committed; the seed only reads them. Re-run after changing a scene. Deterministic: the noise seeds
// are fixed, so the same scene gives the same picture.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'e2e', 'package.json'));
const puppeteer = require('puppeteer-core');
const OUT = path.join(here, '..', 'database', 'seed', 'snapshots');
const W = 640, H = 360;

// ---------- drawing helpers ----------
/** A person seen from a corridor camera: head, torso, legs; `pose` changes the limbs. */
function person({ x, y, h = 150, pose = 'stand', hood = false, bag = false, fill = '#d8d8d8', dark = false }) {
  const s = h / 150; // scale
  const c = dark ? '#2a2a2a' : fill;
  const g = [];
  const head = hood ? `<path d="M-14 -126 q14 -22 28 0 v16 h-28z" fill="${c}"/>` : `<circle cx="0" cy="-118" r="11" fill="${c}"/>`;
  const torso = `<path d="M-15 -104 q15 -8 30 0 l4 56 h-38z" fill="${c}"/>`;
  const legs = pose === 'walk'
    ? `<path d="M-13 -48 l-8 48 h10 l10 -40 z" fill="${c}"/><path d="M2 -48 l12 48 h-10 l-10 -40 z" fill="${c}"/>`
    : pose === 'crouch'
      ? `<path d="M-14 -48 l-10 20 l14 28 h9 l-8 -30 z" fill="${c}"/><path d="M3 -48 l16 18 l-4 30 h-9 l-2 -28 z" fill="${c}"/>`
      : `<rect x="-13" y="-48" width="10" height="48" fill="${c}"/><rect x="3" y="-48" width="10" height="48" fill="${c}"/>`;
  const arms = pose === 'reach'
    ? `<path d="M14 -100 l26 -22 l5 6 l-24 26 z" fill="${c}"/><path d="M-15 -98 l-6 44 h7 l6 -42 z" fill="${c}"/>`
    : pose === 'phone'
      ? `<path d="M12 -100 l10 14 l-12 12 l-5 -6 z" fill="${c}"/><path d="M-15 -98 l-6 44 h7 l6 -42 z" fill="${c}"/>`
      : `<path d="M15 -98 l6 44 h-7 l-6 -42 z" fill="${c}"/><path d="M-15 -98 l-6 44 h7 l6 -42 z" fill="${c}"/>`;
  const bagEl = bag ? `<path d="M18 -62 h18 v26 h-18z" fill="${dark ? '#1f1f1f' : '#9a9a9a'}"/><path d="M20 -64 q7 -10 14 0" stroke="${c}" stroke-width="2" fill="none"/>` : '';
  g.push(`<g transform="translate(${x} ${y}) scale(${s})">${head}${torso}${arms}${legs}${bagEl}</g>`);
  // floor shadow
  g.push(`<ellipse cx="${x}" cy="${y + 2}" rx="${22 * s}" ry="${5 * s}" fill="rgba(0,0,0,0.35)"/>`);
  return g.join('');
}

/** Corridor with a door at the end wall; sign text above the door. */
function corridor({ sign, doubleDoor = false, keypad = false, window = false }) {
  const door = doubleDoor
    ? `<rect x="250" y="120" width="140" height="150" fill="#9ea7ad" stroke="#5b6166" stroke-width="3"/><line x1="320" y1="120" x2="320" y2="270" stroke="#5b6166" stroke-width="3"/>
       <circle cx="285" cy="165" r="12" fill="#cfd8dc" stroke="#5b6166" stroke-width="2"/><circle cx="355" cy="165" r="12" fill="#cfd8dc" stroke="#5b6166" stroke-width="2"/>
       <rect x="306" y="200" width="8" height="26" rx="2" fill="#3a3f43"/><rect x="326" y="200" width="8" height="26" rx="2" fill="#3a3f43"/>`
    : `<rect x="272" y="124" width="96" height="146" fill="#8c959b" stroke="#4e5458" stroke-width="3"/>${window ? '<rect x="292" y="140" width="56" height="40" fill="#cfd8dc" stroke="#4e5458" stroke-width="2"/>' : ''}<rect x="344" y="200" width="8" height="22" rx="2" fill="#2f3336"/>`;
  return `
    <rect x="0" y="0" width="${W}" height="${H}" fill="#6b7075"/>
    <!-- end wall -->
    <rect x="200" y="80" width="240" height="190" fill="#8a9196"/>
    <!-- side walls (perspective) -->
    <polygon points="0,0 200,80 200,270 0,360" fill="#747a80"/>
    <polygon points="640,0 440,80 440,270 640,360" fill="#7d8389"/>
    <!-- ceiling and floor -->
    <polygon points="0,0 640,0 440,80 200,80" fill="#9aa0a5"/>
    <polygon points="0,360 640,360 440,270 200,270" fill="#5e6368"/>
    <!-- floor tiles -->
    <g stroke="rgba(255,255,255,0.12)" stroke-width="1.5">
      <line x1="0" y1="360" x2="200" y2="270"/><line x1="640" y1="360" x2="440" y2="270"/>
      <line x1="120" y1="360" x2="260" y2="270"/><line x1="520" y1="360" x2="380" y2="270"/><line x1="320" y1="360" x2="320" y2="270"/>
      <line x1="60" y1="330" x2="580" y2="330"/><line x1="130" y1="300" x2="510" y2="300"/><line x1="170" y1="283" x2="470" y2="283"/>
    </g>
    <!-- ceiling lamp strips -->
    <g fill="rgba(255,255,255,0.28)"><rect x="260" y="30" width="120" height="8"/><rect x="290" y="62" width="60" height="6"/></g>
    <!-- wall rail -->
    <line x1="0" y1="250" x2="200" y2="200" stroke="rgba(0,0,0,0.25)" stroke-width="4"/><line x1="640" y1="250" x2="440" y2="200" stroke="rgba(0,0,0,0.25)" stroke-width="4"/>
    ${door}
    ${keypad ? '<rect x="378" y="168" width="14" height="22" fill="#2c3034"/><circle cx="385" cy="173" r="2" fill="#4caf50"/>' : ''}
    <rect x="236" y="82" width="168" height="22" rx="2" fill="#f2f4f5" stroke="#5b6166" stroke-width="1.5"/>
    <text x="320" y="98" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#1f2a30" letter-spacing="1">${sign}</text>`;
}

/** Cash desk: a counter with a glass window, a sign «KASSA», a monitor; the camera looks from the room side. */
function cashDesk() {
  return `
    <rect x="0" y="0" width="${W}" height="${H}" fill="#6f7579"/>
    <rect x="0" y="0" width="${W}" height="230" fill="#858c92"/>
    <polygon points="0,360 640,360 640,230 0,230" fill="#5a5f64"/>
    <rect x="130" y="60" width="380" height="170" fill="#aab3b8"/>
    <rect x="150" y="80" width="340" height="130" fill="#c9d3d8" opacity="0.8"/>
    <rect x="150" y="80" width="340" height="130" fill="none" stroke="#4e5458" stroke-width="3"/>
    <rect x="150" y="196" width="340" height="14" fill="#8e979c"/>
    <rect x="130" y="210" width="380" height="60" fill="#8a8f93" stroke="#45494d" stroke-width="2"/>
    <rect x="260" y="40" width="120" height="22" rx="2" fill="#f2f4f5" stroke="#5b6166" stroke-width="1.5"/>
    <text x="320" y="56" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="#1f2a30" letter-spacing="2">KASSA</text>
    <rect x="200" y="140" width="60" height="44" fill="#2b3034"/><rect x="226" y="184" width="8" height="10" fill="#2b3034"/>
    <rect x="390" y="150" width="64" height="40" fill="#40464b"/>
    <g stroke="rgba(255,255,255,0.1)" stroke-width="1.5"><line x1="0" y1="300" x2="640" y2="300"/><line x1="0" y1="335" x2="640" y2="335"/><line x1="160" y1="360" x2="200" y2="230"/><line x1="480" y1="360" x2="440" y2="230"/></g>`;
}

/** Reception at night: desk, chairs, a plant. */
function reception() {
  return `
    <rect x="0" y="0" width="${W}" height="${H}" fill="#676d72"/>
    <rect x="0" y="0" width="${W}" height="240" fill="#7f868c"/>
    <polygon points="0,360 640,360 640,240 0,240" fill="#55595e"/>
    <rect x="60" y="150" width="260" height="90" rx="6" fill="#9ea6ab" stroke="#4a5054" stroke-width="2"/>
    <rect x="60" y="150" width="260" height="14" fill="#c8d0d4"/>
    <rect x="150" y="118" width="40" height="30" fill="#2b3034"/><rect x="166" y="148" width="8" height="6" fill="#2b3034"/>
    <g fill="#8c9397" stroke="#45494d" stroke-width="2">
      <rect x="420" y="190" width="44" height="34" rx="3"/><rect x="474" y="190" width="44" height="34" rx="3"/><rect x="528" y="190" width="44" height="34" rx="3"/>
      <rect x="420" y="168" width="44" height="24" rx="3"/><rect x="474" y="168" width="44" height="24" rx="3"/><rect x="528" y="168" width="44" height="24" rx="3"/>
    </g>
    <g fill="#5d6a5c"><ellipse cx="600" cy="150" rx="28" ry="36"/><rect x="588" y="180" width="24" height="30" fill="#6d6256"/></g>
    <rect x="200" y="60" width="240" height="28" rx="3" fill="#f2f4f5" stroke="#5b6166" stroke-width="1.5"/>
    <text x="320" y="80" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#1f2a30" letter-spacing="2">QABULXONA</text>
    <g stroke="rgba(255,255,255,0.1)" stroke-width="1.5"><line x1="0" y1="300" x2="640" y2="300"/><line x1="0" y1="335" x2="640" y2="335"/></g>`;
}

/** The camera's own on-screen overlay: time (top left), channel name (bottom right), optional zone and target box. */
function overlay({ time, channel, zone, box, label, note }) {
  const z = zone ? `<polygon points="${zone}" fill="rgba(255,40,40,0.1)" stroke="#ff3b3b" stroke-width="2"/>` : '';
  const b = box ? `<rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="none" stroke="#39ff5a" stroke-width="2"/>
    <rect x="${box[0]}" y="${box[1] - 16}" width="${(label || 'Human').length * 8 + 10}" height="16" fill="#39ff5a"/>
    <text x="${box[0] + 5}" y="${box[1] - 4}" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#0b2a10">${label || 'Human'}</text>` : '';
  const n = note ? `<text x="${W / 2}" y="${H - 14}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="#ff5252" stroke="#000" stroke-width="2.5" paint-order="stroke">${note}</text>` : '';
  const osd = (x, y, s, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="bold" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" letter-spacing="0.5">${s}</text>`;
  return `${z}${b}${n}${osd(10, 22, time)}${osd(W - 10, H - 12, channel, 'end')}`;
}

/** Post-processing: night = infrared look (gray, grainy, bright highlights); day = muted colour; tamper = covered. */
function filters(mode, seed) {
  if (mode === 'tamper') return '';
  const grain = mode === 'night' ? 0.55 : 0.18;
  return `<filter id="look" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      ${mode === 'night' ? '<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="0.62"/><feFuncG type="linear" slope="0.62"/><feFuncB type="linear" slope="0.62"/></feComponentTransfer>' : '<feColorMatrix type="saturate" values="0.55"/>'}
      <feGaussianBlur stdDeviation="${mode === 'night' ? 0.7 : 0.35}"/>
    </filter>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${mode === 'night' ? 0.9 : 0.4}"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${grain}"/></feComponentTransfer></filter>
    <radialGradient id="vig" cx="50%" cy="50%" r="70%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${mode === 'night' ? 0.7 : 0.35}"/></radialGradient>`;
}

function frame({ scene, figure = '', mode, seed, osd }) {
  const defs = filters(mode, seed);
  let body;
  if (mode === 'tamper') {
    // a hand over the lens: almost black, a blurred shape, light leaking at one corner
    body = `<rect width="${W}" height="${H}" fill="#070707"/>
      <defs><filter id="bl"><feGaussianBlur stdDeviation="18"/></filter><filter id="gr"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${seed}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer></filter></defs>
      <ellipse cx="520" cy="60" rx="180" ry="120" fill="#4a4036" filter="url(#bl)"/>
      <path d="M-40 400 Q120 40 360 120 T700 420 Z" fill="#2a2420" filter="url(#bl)"/>
      <ellipse cx="300" cy="230" rx="260" ry="170" fill="#1a1613" filter="url(#bl)"/>
      <rect width="${W}" height="${H}" filter="url(#gr)" opacity="0.9"/>`;
  } else {
    body = `<defs>${defs}</defs>
      <g filter="url(#look)">${scene}</g>
      <g filter="url(#soft)">${figure}</g>
      <rect width="${W}" height="${H}" filter="url(#grain)" style="mix-blend-mode:overlay"/>
      <rect width="${W}" height="${H}" fill="url(#vig)"/>
      ${mode === 'night' ? `<g stroke="rgba(0,0,0,0.18)" stroke-width="1">${Array.from({ length: H / 3 }, (_, i) => `<line x1="0" y1="${i * 3}" x2="${W}" y2="${i * 3}"/>`).join('')}</g>` : ''}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}${overlay(osd)}</svg>`;
}

// ---------- the scenes the seed uses (file name → frame) ----------
const OR = 'OPERATSIYA BLOKI';
const SCENES = {
  // a stranger at the operating-block door in the afternoon (region entrance, «always» mode → alert)
  'or-day-stranger': { mode: 'day', seed: 11, osd: { time: '14:36:12', channel: 'Operatsiya bloki', zone: '236,118 404,118 470,275 170,275', box: [330, 126, 62, 150], label: 'Human' },
    scene: corridor({ sign: OR, doubleDoor: true }), figure: person({ x: 362, y: 274, h: 150, pose: 'reach', bag: true, fill: '#3d4a57' }) },
  // this morning: somebody waiting at the same door for minutes (loitering, still open)
  'or-day-loitering': { mode: 'day', seed: 12, osd: { time: '09:48:51', channel: 'Operatsiya bloki', zone: '236,118 404,118 470,275 170,275', box: [238, 128, 60, 148], label: 'Human 03:10', note: 'LOITERING' },
    scene: corridor({ sign: OR, doubleDoor: true }), figure: person({ x: 268, y: 274, h: 148, pose: 'phone', hood: true, fill: '#4a4f55' }) },
  // the pharmacy store door at night (region entrance), two different nights
  'store-night-1': { mode: 'night', seed: 21, osd: { time: '23:40:07', channel: 'Dori ombori', zone: '262,116 378,116 420,278 220,278', box: [292, 124, 64, 152], label: 'Human' },
    scene: corridor({ sign: 'DORI OMBORI', keypad: true }), figure: person({ x: 324, y: 274, h: 152, pose: 'reach', hood: true, fill: '#cfcfcf' }) },
  'store-night-2': { mode: 'night', seed: 22, osd: { time: '23:12:33', channel: 'Dori ombori', zone: '262,116 378,116 420,278 220,278', box: [236, 124, 70, 156], label: 'Human' },
    scene: corridor({ sign: 'DORI OMBORI', keypad: true }), figure: person({ x: 272, y: 278, h: 156, pose: 'walk', bag: true, fill: '#d6d6d6' }) },
  // the store door by day: a person hanging around with a bag (loitering, acknowledged)
  'store-day-loitering': { mode: 'day', seed: 23, osd: { time: '13:20:45', channel: 'Dori ombori', zone: '262,116 378,116 420,278 220,278', box: [384, 126, 58, 150], label: 'Human 02:40', note: 'LOITERING' },
    scene: corridor({ sign: 'DORI OMBORI', keypad: true }), figure: person({ x: 412, y: 276, h: 150, pose: 'stand', bag: true, fill: '#35404a' }) },
  // the cash desk at night: somebody behind the counter (intrusion)
  'cash-night-intrusion': { mode: 'night', seed: 31, osd: { time: '02:15:19', channel: 'Kassa', zone: '150,80 490,80 490,230 150,230', box: [300, 96, 70, 134], label: 'Human' },
    scene: cashDesk(), figure: person({ x: 336, y: 230, h: 134, pose: 'crouch', hood: true, fill: '#d2d2d2' }) },
  // the Yunusobod cash window at night: line crossing and a region entrance
  'yun-cash-night-line': { mode: 'night', seed: 32, osd: { time: '21:35:58', channel: 'Kassa (Yunusobod)', zone: '110,236 530,236', box: [430, 150, 66, 170], label: 'Human' },
    scene: cashDesk(), figure: `<line x1="110" y1="236" x2="530" y2="236" stroke="#ff3b3b" stroke-width="2" stroke-dasharray="8 6"/>` + person({ x: 464, y: 320, h: 170, pose: 'walk', fill: '#d0d0d0' }) },
  'yun-cash-night-region': { mode: 'night', seed: 33, osd: { time: '22:18:04', channel: 'Kassa (Yunusobod)', zone: '150,80 490,80 490,230 150,230', box: [196, 90, 72, 140], label: 'Human' },
    scene: cashDesk(), figure: person({ x: 232, y: 230, h: 140, pose: 'reach', fill: '#d4d4d4' }) },
  // the lens covered (tamper): nothing to see, which is the point
  'cash-tamper': { mode: 'tamper', seed: 41, osd: { time: '06:58:40', channel: 'Kassa', note: 'VIDEO TAMPERING' }, scene: '' },
  // the reception at night: somebody walking through the lobby (intrusion, after hours)
  'reception-night': { mode: 'night', seed: 51, osd: { time: '01:05:27', channel: 'Asosiy kirish', zone: '40,120 600,120 600,340 40,340', box: [350, 140, 74, 180], label: 'Human' },
    scene: reception(), figure: person({ x: 388, y: 320, h: 180, pose: 'walk', hood: true, bag: true, fill: '#d0d0d0' }) },
};

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [`--window-size=${W},${H}`] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  for (const [name, s] of Object.entries(SCENES)) {
    const svg = frame(s);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">${svg}</body></html>`);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 68, clip: { x: 0, y: 0, width: W, height: H } });
    const file = path.join(OUT, name + '.jpg');
    writeFileSync(file, jpg);
    console.log(`${name}.jpg  ${Math.round(statSync(file).size / 1024)} KB`);
  }
} finally { await browser.close(); }
