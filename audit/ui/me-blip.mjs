// One failed background refetch of /me (network blip / 503) while the doctor has unsaved note text.
import { launch, ctxPage, login, track, sleep, SH, save, settle } from './common.mjs';
const out = []; const note = (k, v) => { out.push({ k, v }); console.log('•', k, JSON.stringify(v)?.slice(0, 400)); };
const mode = process.argv[2] || 'abort';
const b = await launch();
const p = await ctxPage(b); track(p);
p.on('dialog', (d) => { note('browser dialog', d.message()); d.accept(); });
await login(p, 'Shifokor'); await settle(p); await sleep(800);
note('url before', p.url());
await p.evaluate(() => { const lab = [...document.querySelectorAll('label')].find((l) => l.textContent.startsWith('Anamnez')); const el = document.getElementById(lab.htmlFor); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, el.value + ' SAQLANMAGAN MATN'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await p.setRequestInterception(true);
let blocked = 0;
p.on('request', (r) => { if (/\/api\/v1\/me$/.test(r.url()) && blocked < 1) { blocked++; mode === 'abort' ? r.abort('internetdisconnected') : r.respond({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE","message":"x"}}' }); } else r.continue(); });
await sleep(61000); // /me staleTime is 60 s
await p.evaluate(() => { window.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
await sleep(4000);
note(`after one failed /me (${mode}): url`, p.url());
note('/me requests blocked', blocked);
note('unsaved text still on screen', await p.evaluate(() => [...document.querySelectorAll('textarea')].some((t) => t.value.includes('SAQLANMAGAN MATN'))));
await p.screenshot({ path: SH + `me-blip-${mode}.png` });
await save(`me-blip-${mode}.json`, out);
await b.close().catch(() => undefined); process.exit(0);
