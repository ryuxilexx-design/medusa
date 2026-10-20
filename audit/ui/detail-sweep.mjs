// Detail + print pages per role: what each role sees by direct URL.
import { launch, ctxPage, login, track, go, layout, axe, text, save, SH, ROLES, sleep } from './common.mjs';
const ids = JSON.parse(process.argv[2]);
const PAGES = [
  `/patients/${ids.patient}`, `/cashier/${ids.invoice}`,
  `/print/payment/${ids.payment}`, `/print/shift/${ids.shift}`, `/print/lab/${ids.labverified}`, `/print/lab/${ids.labpending}`,
  `/print/note/${ids.note}`, `/print/consent/${ids.consentPatient}`, `/print/consent/blank`, `/print/uzi/${ids.uzi}`, `/print/document/00000000-0000-0000-0000-000000000000`,
  `/patients/00000000-0000-0000-0000-000000000000`, `/cashier/00000000-0000-0000-0000-000000000000`, `/patients/not-a-uuid`, `/doctor?appointment=not-a-uuid`, `/nope-route`,
];
const browser = await launch();
const results = [];
for (const [role, label] of Object.entries(ROLES)) {
  const page = await ctxPage(browser);
  const log = track(page);
  await login(page, label);
  for (const r of PAGES) {
    log.console.length = 0; log.net.length = 0;
    await go(page, r); await sleep(700);
    const txt = (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, ' ');
    const shotName = `detail-${role}${r.replace(/[\/?=]/g, '-').slice(0, 60)}.png`;
    await page.screenshot({ path: SH + shotName });
    const ax = role === 'manager' || role === 'doctor' ? await axe(page).catch(() => []) : [];
    results.push({ role, route: r, net: [...log.net], console: log.console.filter((c) => !c.includes('Failed to load resource')), text: txt, axe: ax, shot: shotName, layout: await layout(page) });
    console.log(role, r.slice(0, 50), '| net', log.net.join(','), '|', txt.slice(0, 110));
  }
  await page.browserContext().close();
}
await save('detail.json', results);
await browser.close();
