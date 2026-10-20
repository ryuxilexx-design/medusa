// Every role × every route: load, screenshot, console/network errors, layout overflow, axe. Usage: node sweep.mjs [width height tag]
import { launch, ctxPage, login, track, go, layout, axe, text, save, SH, ROLES, ROUTES, ALLOWED, sleep, BASE } from './common.mjs';
const W = Number(process.argv[2] || 1366), H = Number(process.argv[3] || 768), TAG = process.argv[4] || 'd';
const doAxe = W === 1366;
const browser = await launch();
const results = [];
for (const [role, label] of Object.entries(ROLES)) {
  const page = await ctxPage(browser, { width: W, height: H });
  const log = track(page);
  await login(page, label);
  for (const r of ROUTES) {
    if (process.env.ONLY_ALLOWED && !ALLOWED[role].includes(r)) continue;
    log.console.length = 0; log.net.length = 0; log.big.length = 0;
    await go(page, r);
    await sleep(800);
    const lay = await layout(page);
    const txt = (await text(page)).slice(0, 400).replace(/\s+/g, ' ');
    const allowed = ALLOWED[role].includes(r);
    const shotName = `sweep-${TAG}-${role}${r.replace(/\//g, '-')}.png`;
    await page.screenshot({ path: SH + shotName, fullPage: W < 800 });
    let ax = [];
    if (doAxe && allowed) ax = await axe(page).catch((e) => [{ id: 'axe-failed', help: e.message }]);
    const row = { role, route: r, allowed, finalPath: new URL(page.url()).pathname, console: [...log.console], net: [...log.net], big: [...log.big], layout: lay, text: txt, axe: ax, shot: shotName };
    results.push(row);
    console.log(role, r, allowed ? 'A' : '-', row.finalPath, 'net:', row.net.length, 'con:', row.console.length, lay.hscroll ? 'HSCROLL' : '', 'axe:', ax.length, '|', txt.slice(0, 90));
  }
  await page.browserContext().close();
}
await save(`sweep-${TAG}.json`, results);
await browser.close();
