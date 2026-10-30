#!/usr/bin/env node
// MedPlus → Med.uz.ai bridge (runs on the clinic's Windows PC next to MedPlus). docs/MEDPLUS_SYNC.md
//
//   node bridge.mjs --probe [--out f]  list MedPlus tables and columns (schema only, no rows) → send the output to us
//                                      (without mysql.database: the list of databases, to find MedPlus's one)
//   node bridge.mjs --dry-run          read with queries.json and print counts; sends nothing, keeps no cursor
//   node bridge.mjs --once             one pass (Windows Task Scheduler every minute)
//   node bridge.mjs                    run forever, one pass every interval_sec (as a service)
//
// Options: --config config.json (default: next to this file), --queries queries.json.
import { appendFileSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileCursorStore, httpSender, loadQueries, memoryCursorStore, runOnce, takeLock, FatalSendError } from './core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const configPath = resolve(opt('--config', join(here, 'config.json')));
if (!existsSync(configPath)) { console.error(`config topilmadi: ${configPath} (config.example.json dan nusxa oling)`); process.exit(2); }
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const base = dirname(configPath);
const logDir = resolve(base, cfg.log_dir ?? 'logs');

/** One line per event: time, message — kinds, counts, cursors and error codes only (never a row). Kept 14 days. */
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    if (!existsSync(logDir)) return;
    appendFileSync(join(logDir, `bridge-${line.slice(0, 10)}.log`), line + '\n');
    for (const f of readdirSync(logDir)) {
      const m = /^bridge-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && Date.now() - Date.parse(m[1]) > 14 * 86_400_000) unlinkSync(join(logDir, f));
    }
  } catch { /* logging never stops the bridge */ }
}

async function source() {
  const { mysqlSource } = await import('./mysql.mjs');
  return mysqlSource(cfg.mysql ?? {});
}

async function probe() {
  const src = await source();
  try {
    const text = JSON.stringify(await src.probe(), null, 1);
    // --out writes UTF-8 itself (PowerShell's «>» would write UTF-16)
    const out = opt('--out', null);
    if (out) { writeFileSync(resolve(out), text + '\n'); console.log(`saqlandi: ${resolve(out)}`); } else console.log(text);
  } finally { await src.close(); }
}

async function pass(dryRun) {
  const queries = loadQueries(JSON.parse(readFileSync(resolve(base, opt('--queries', cfg.queries ?? 'queries.json')), 'utf8')));
  const token = process.env.MEDPLUS_BRIDGE_TOKEN || cfg.token;
  if (!dryRun && (!cfg.server || !cfg.source_id || !token)) throw new Error('config: server, source_id va token kerak');
  if (!dryRun && !/^https:\/\//.test(cfg.server) && !cfg.allow_http) throw new Error('config: server https:// bilan boshlanishi kerak');
  const lock = dryRun ? { release() {} } : takeLock(resolve(base, 'bridge.lock'));
  if (!lock) { log('oldingi o‘tish hali tugamagan — bu safar o‘tkazib yuborildi'); return; }
  const src = await source();
  try {
    const summary = await runOnce({
      source: src, queries, dryRun, log,
      cursors: dryRun ? memoryCursorStore() : fileCursorStore(resolve(base, cfg.cursor_file ?? 'cursor.json')),
      send: httpSender({ server: cfg.server ?? '', sourceId: cfg.source_id, token, log }),
      limit: Math.min(1000, Math.max(10, Number(cfg.batch_size ?? 200))),
      maxBatches: Math.max(1, Number(cfg.max_batches_per_run ?? 50)),
    });
    if (dryRun) console.log(JSON.stringify(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { read: v.read, skipped: v.skipped }])), null, 1));
  } finally {
    await src.close().catch(() => undefined);
    lock.release();
  }
}

async function main() {
  if (flag('--probe')) return probe();
  if (flag('--dry-run')) return pass(true);
  if (flag('--once')) return pass(false);
  const every = Math.max(15, Number(cfg.interval_sec ?? 60)) * 1000;
  log(`ko‘prik ishga tushdi, har ${every / 1000} s`);
  for (;;) {
    try { await pass(false); } catch (e) {
      log(`xato: ${e instanceof FatalSendError ? `server ${e.status} ${e.code} — sozlamani tekshiring` : e.message}`);
      if (e instanceof FatalSendError && e.status === 401) await new Promise((r) => setTimeout(r, 10 * 60_000)); // a revoked key: do not knock every minute
    }
    await new Promise((r) => setTimeout(r, every));
  }
}

main().catch((e) => { log(`xato: ${e instanceof FatalSendError ? `server ${e.status} ${e.code}` : e.message}`); process.exit(1); });
