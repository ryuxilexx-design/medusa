#!/usr/bin/env node
// Builds the offline package for the clinic PC (docs/MEDPLUS_SYNC.md «Installing the bridge»):
//   bridge + pinned node_modules (npm ci) + the Windows helpers at the root + a portable node.exe (win-x64),
//   so nothing has to be installed or downloaded at the clinic.
//
//   node tools/medplus-bridge/pack.mjs [--out <dir>] [--node 22.23.3] [--no-node]
//
// node.exe comes from nodejs.org and is checked against the release's SHASUMS256.txt. Needs `zip`/`unzip` (macOS, Linux).
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const NODE_VERSION = opt('--node', '22.23.3');
if (!/^\d+\.\d+\.\d+$/.test(NODE_VERSION)) throw new Error('--node: masalan 22.23.3');
const outDir = resolve(opt('--out', join(here, '..', '..', 'dist')));
const withNode = !argv.includes('--no-node');

const stage = mkdtempSync(join(tmpdir(), 'medplus-bridge-'));
const root = join(stage, 'medplus-bridge');
mkdirSync(root);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
const sha256 = (file) => new Promise((ok, fail) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (b) => h.update(b)).on('end', () => ok(h.digest('hex'))).on('error', fail);
});

try {
  for (const f of ['bridge.mjs', 'core.mjs', 'mysql.mjs', 'package.json', 'package-lock.json', 'config.example.json', 'queries.example.json']) cpSync(join(here, f), join(root, f));
  cpSync(join(here, 'windows'), root, { recursive: true }); // README-UZ.txt, *.bat, *.sql at the package root
  cpSync(join(here, '..', '..', 'docs', 'MEDPLUS_SYNC.md'), join(root, 'MEDPLUS_SYNC.md'));
  run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], root);

  if (withNode) {
    const name = `node-v${NODE_VERSION}-win-x64`;
    const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
    const zipFile = join(stage, `${name}.zip`);
    const res = await fetch(`${base}/${name}.zip`);
    if (!res.ok) throw new Error(`${name}.zip: HTTP ${res.status}`);
    writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
    const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
    const want = sums.split('\n').find((l) => l.endsWith(`  ${name}.zip`))?.split(/\s+/)[0];
    const got = await sha256(zipFile);
    if (!want || want !== got) throw new Error(`${name}.zip: SHA-256 mos emas (kutilgan ${want}, olingan ${got})`);
    mkdirSync(join(root, 'node'));
    run('unzip', ['-q', '-j', zipFile, `${name}/node.exe`, `${name}/LICENSE`, '-d', join(root, 'node')], stage);
    console.log(`node.exe v${NODE_VERSION} (SHA-256 tekshirildi)`);
  }

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const out = join(outDir, `medplus-bridge-${stamp}.zip`);
  rmSync(out, { force: true });
  run('zip', ['-q', '-r', '-X', out, 'medplus-bridge'], stage);
  const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
  console.log(`tayyor: ${out} (ko‘prik ${pkg.version}${withNode ? `, node ${NODE_VERSION}` : ', node.exe yo‘q'})`);
  if (!existsSync(out)) process.exit(1);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
