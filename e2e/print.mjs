// Renders each printable document to A4 PDF (print CSS) to check that nothing is cut off.
import { launch, newPage, login, settle, BASE, SHOTS } from './lib.mjs';
const errors = []; const b = await launch();
const doc = await newPage(b, errors); await login(doc, 'Shifokor', 'Akmal Rasulov');
const note = await doc.evaluate(() => fetch('/api/v1/appointments?date=2026-10-18').then((r) => r.json()).then((j) => j.data.find((a) => a.status === 'completed' && a.encounter_id).encounter_id));
const labId = await doc.evaluate(() => fetch('/api/v1/orders?status=verified').then((r) => r.json()).then((j) => j.data[0].id));
const uzi = await newPage(b, errors); await login(uzi, 'Shifokor', 'Kamola Ismoilova');
const uziId = await uzi.evaluate(() => fetch('/api/v1/diagnostics').then((r) => r.json()).then((j) => j.data.find((x) => x.report_status === 'signed').id));
const cas = await newPage(b, errors); await login(cas, 'Kassir');
const payId = await cas.evaluate(() => fetch('/api/v1/payments?from=2026-10-01&to=2026-10-18').then((r) => r.json()).then((j) => j.data[0].id));
for (const [page, path, name] of [[doc, `/print/note/${note}`, 'note'], [doc, `/print/lab/${labId}`, 'lab'], [uzi, `/print/uzi/${uziId}`, 'uzi'], [cas, `/print/payment/${payId}`, 'payment']]) {
  await page.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(page);
  await page.emulateMediaType('print');
  const pdf = await page.pdf({ path: `${SHOTS}print-${name}.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  await page.screenshot({ path: `${SHOTS}print-${name}.png`, fullPage: true });
  await page.emulateMediaType('screen');
  console.log(`${name}: ${pages} sahifa A4`);
}
console.log('ERRORS:', errors);
await b.close();
