// npm run db:import-medplus -- --file export.xlsx --kind patients|payments|services [--tenant "<clinic name or id>"] [--dry-run] [--map "field=Header,…"]
// The server-console twin of «Integratsiyalar → Fayldan import» (docs/MEDPLUS_SYNC.md): the same reader, the same
// column guess and the same upsert path as the bridge, without the 10 MB / 30 000-row limit of the web upload.
// Prints counts and row numbers with error codes only — never a name, a phone or any other cell value.
import { readFileSync } from 'fs';
import { migrate } from '@meduza/db';
import { Db } from '../core/db';
import { syncClock } from '../core/clock';
import { IMPORT_FIELDS, IMPORT_KINDS, ImportKind, normHeader, prepareRecords, readImport } from '../sync/file-import';
import { RecordResult, runBatch, Source, systemCtx } from '../sync/ingest';

const USAGE = `Foydalanish:
  npm run db:import-medplus -- --file <fayl.xlsx|.csv> --kind patients|payments|services [--tenant "<klinika nomi yoki id>"] [--dry-run] [--map "maydon=Sarlavha,…"]

  Tartib: avval patients, keyin services (xizmatlar hisoboti), oxirida payments (kassa tarixi).
  --dry-run  hech narsa yozmaydi: nima bo‘lishini sanaydi.
  --map      taxminni o‘zgartirish, masalan --map "external_id=ID,full_name=ФИО пациента"`;

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[++i];
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  const kind = a.kind as ImportKind;
  if (!a.file || a.file === 'true' || !IMPORT_KINDS.includes(kind)) { console.error(USAGE); process.exit(2); }
  const db = new Db();
  try {
    await migrate(db.pool, () => undefined);
    syncClock((await db.one('SELECT demo_now() AS n'))!.n);
    const tenant = a.tenant && a.tenant !== 'true' ? a.tenant.trim() : null;
    const sources = await db.rows<Source & { tenant_name: string }>(
      `SELECT s.id, s.tenant_id, s.kind, s.name, s.settings, t.name AS tenant_name FROM external_sources s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.kind = 'medplus' AND ($1::text IS NULL OR t.id::text = $1 OR lower(t.name) = lower($1))`, [tenant]);
    if (sources.length !== 1) {
      console.error(sources.length ? 'Bir nechta klinikada MedPlus ulangan — --tenant bilan tanlang.' : 'MedPlus ulanmagan: avval Sozlamalar → Integratsiyalar → «MedPlus’ni ulash».');
      process.exit(2);
    }
    const src = sources[0];
    const { table, headerRow, headers, guess } = readImport(readFileSync(a.file), kind);
    const mapping = { ...guess };
    if (a.map && a.map !== 'true') {
      for (const pair of a.map.split(',')) {
        const [field, header] = pair.split('=').map((x) => x.trim());
        if (!IMPORT_FIELDS[kind].some((f) => f.key === field)) { console.error(`Noma’lum maydon: ${field}`); process.exit(2); }
        const i = headers.findIndex((h) => normHeader(h) === normHeader(header));
        if (i < 0) { console.error(`Ustun topilmadi: ${header}`); process.exit(2); }
        mapping[field] = i;
      }
    }
    console.log(`Klinika: ${src.tenant_name}; sarlavha qatori: ${headerRow + 1}`);
    for (const f of IMPORT_FIELDS[kind]) console.log(`  ${f.key.padEnd(15)} ← ${mapping[f.key] === undefined ? (f.required ? 'TOPILMADI (majburiy)' : '—') : headers[mapping[f.key]]}`);
    const missing = IMPORT_FIELDS[kind].filter((f) => f.required && mapping[f.key] === undefined);
    if (missing.length) { console.error(`Majburiy ustun yo‘q: ${missing.map((f) => f.key).join(', ')} — --map bilan ko‘rsating.`); process.exit(2); }
    const prep = prepareRecords(table, kind, mapping, headerRow, Number.MAX_SAFE_INTEGER);
    const ctx = { ...systemCtx(src), name: 'CLI' };
    const dry = a['dry-run'] === 'true';
    const total = { received: 0, created: 0, updated: 0, unchanged: 0, parked: 0, skipped: 0, errors: 0 } as Record<string, number>;
    const bad: RecordResult[] = [];
    const chunk = dry ? prep.records.length || 1 : 1000;
    for (let i = 0; i < prep.records.length; i += chunk) {
      const r = await runBatch(db, src, prep.records.slice(i, i + chunk), { channel: 'file', actor: 'CLI', ctx, dryRun: dry, withResults: true });
      for (const k of Object.keys(total)) total[k] += (r as any)[k];
      bad.push(...(r.results ?? []).filter((x) => x.outcome === 'error' || x.outcome === 'parked'));
      if (!dry) process.stdout.write(`\r${Math.min(i + chunk, prep.records.length)} / ${prep.records.length}`);
    }
    if (!dry) process.stdout.write('\n');
    console.log(`${dry ? 'Tekshiruv (hech narsa yozilmadi)' : 'Import tugadi'}: qatorlar ${prep.total}, yangi ${total.created}, yangilangan ${total.updated}, o‘zgarmagan ${total.unchanged}, kutmoqda ${total.parked}, xato ${total.errors + prep.errors.length}`);
    const lines = [...prep.errors.map((e) => `  qator ${e.row}: ${e.code}${e.field ? ` (${e.field})` : ''}`), ...bad.map((x) => `  qator ${prep.rowOf.get(x.external_id) ?? '?'}: ${x.outcome === 'parked' ? 'kutmoqda — ' : ''}${x.code}`)];
    if (lines.length) console.log(lines.slice(0, 50).join('\n') + (lines.length > 50 ? `\n  … yana ${lines.length - 50} ta` : ''));
  } finally {
    await db.pool.end();
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
