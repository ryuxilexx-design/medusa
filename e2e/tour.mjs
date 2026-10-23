import { launch, newPage, login, shot, settle, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const tours = {
  Rahbar: ['/dashboard', '/patients', '/schedule', '/queue', '/lab', '/cashier', '/finance', '/staff', '/inventory', '/reports', '/settings'],
  Registrator: ['/schedule', '/patients', '/queue'],
  Shifokor: ['/doctor', '/patients', '/diagnostics', '/reports', '/materials'],
  Kassir: ['/cashier', '/finance'],
  Laboratoriya: ['/lab', '/materials'],
  Omborchi: ['/inventory', '/inventory?tab=requests', '/inventory?tab=controlled'],
};
let p = await newPage(b, errors);
await p.goto(BASE + '/login', { waitUntil: 'networkidle0' }); await shot(p, '00-login');
for (const [role, paths] of Object.entries(tours)) {
  p = await newPage(b, errors);
  await login(p, role);
  for (const path of paths) {
    await p.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(p);
    await shot(p, `${role}-${path.slice(1)}`);
    const t = await p.evaluate(() => document.body.innerText.slice(0, 0));
  }
}
console.log('ERRORS:\n' + errors.join('\n'));
await b.close();
