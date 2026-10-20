/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Deterministic synthetic demo data for Med.uz.ai.
 *
 * Everything is derived from the demo date and a fixed PRNG seed, and every id is a
 * stable hash of a fixture key, so running the seed twice yields identical rows.
 * No statistic is stored: dashboards compute everything from these records.
 * All people, phones and addresses are synthetic.
 */
import { createHash } from 'crypto';

export const DEMO_TIMEZONE_OFFSET_HOURS = 5; // Asia/Tashkent, no DST

type Row = Record<string, any>;
export interface SeedData {
  tenants: Row[]; branches: Row[]; users: Row[]; memberships: Row[]; doctors: Row[]; rooms: Row[];
  schedules: Row[]; services: Row[]; service_prices: Row[]; doctor_services: Row[]; patients: Row[];
  appointments: Row[]; queue_counters: Row[]; queue_tickets: Row[]; encounters: Row[]; clinical_notes: Row[];
  service_orders: Row[]; lab_results: Row[]; diagnostic_reports: Row[]; invoices: Row[]; invoice_items: Row[];
  payments: Row[]; expenses: Row[]; inventory_items: Row[]; inventory_movements: Row[]; audit_logs: Row[]; cash_shifts: Row[];
  patient_consents: Row[];
}

export function sid(key: string): string {
  const h = createHash('sha1').update('meduza-demo:' + key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export const SEED_IDS = {
  tenant: sid('tenant:main'),
  tenant2: sid('tenant:second'),
  branchCentral: sid('branch:central'),
  branchYunusobod: sid('branch:yunusobod'),
  branchTenant2: sid('branch:t2'),
  membership: {
    manager: sid('membership:manager'),
    registrar: sid('membership:registrar1'),
    registrar2: sid('membership:registrar2'),
    cashier: sid('membership:cashier1'),
    cashier2: sid('membership:cashier2'),
    lab: sid('membership:lab'),
    tenant2Manager: sid('membership:t2manager'),
    doctor: (i: number) => sid(`membership:doctor:${i}`),
  },
  doctor: (i: number) => sid(`doctor:${i}`),
  patient: (i: number) => sid(`patient:${i}`),
};

// ---------- deterministic helpers ----------
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(date: string): number { return new Date(date + 'T00:00:00Z').getUTCDay(); }
/** Local Tashkent date + minutes since midnight -> UTC Date */
function at(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - DEMO_TIMEZONE_OFFSET_HOURS * 3600_000);
}
function hm(s: string): number { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
const SO = 100; // 1 so'm in tiyin

export function buildSeed(demoDate: string): SeedData {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(demoDate)) throw new Error('DEMO_DATE must be YYYY-MM-DD');
  const rnd = mulberry32(20261018);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const chance = (p: number) => rnd() < p;

  const T = SEED_IDS.tenant;
  const BC = SEED_IDS.branchCentral;
  const BY = SEED_IDS.branchYunusobod;
  const createdBase = at(addDays(demoDate, -90), hm('09:00'));

  const data: SeedData = {
    tenants: [], branches: [], users: [], memberships: [], doctors: [], rooms: [], schedules: [], services: [],
    service_prices: [], doctor_services: [], patients: [], appointments: [], queue_counters: [], queue_tickets: [],
    encounters: [], clinical_notes: [], service_orders: [], lab_results: [], diagnostic_reports: [], invoices: [],
    invoice_items: [], payments: [], expenses: [], inventory_items: [], inventory_movements: [], audit_logs: [], cash_shifts: [],
    patient_consents: [],
  };

  // ---------- tenant, branches ----------
  data.branches.push(
    { id: BC, tenant_id: T, name: 'Markaziy filial', code: 'MRK', address: 'Toshkent, Amir Temur ko‘chasi (demo manzil)', timezone: 'Asia/Tashkent', created_at: createdBase },
    { id: BY, tenant_id: T, name: 'Yunusobod filiali', code: 'YUN', address: 'Toshkent, Yunusobod tumani (demo manzil)', timezone: 'Asia/Tashkent', created_at: createdBase },
  );

  // ---------- staff ----------
  const users: Row[] = data.users;
  const memberships: Row[] = data.memberships;
  const addStaff = (key: string, membershipId: string, fullName: string, role: string, branchIds: string[], title: string, demoCard: boolean, tenantId = T) => {
    const uid = sid('user:' + key);
    users.push({ id: uid, email: `${key}@meduza-demo.example.test`, full_name: fullName, created_at: createdBase });
    memberships.push({ id: membershipId, tenant_id: tenantId, user_id: uid, role, branch_ids: branchIds, title, status: 'active', demo_card: demoCard, created_at: createdBase });
  };
  const M = SEED_IDS.membership;
  addStaff('rahbar', M.manager, 'Dilnoza Karimova', 'manager', [BC, BY], 'Klinika rahbari', true);
  addStaff('registrator1', M.registrar, 'Malika Yusupova', 'registrar', [BC, BY], 'Registrator', true);
  addStaff('registrator2', M.registrar2, 'Shahzod Rahimov', 'registrar', [BY], 'Registrator', false);
  addStaff('kassir1', M.cashier, 'Nodira Aliyeva', 'cashier', [BC, BY], 'Kassir', true);
  addStaff('kassir2', M.cashier2, 'Jasur Toshmatov', 'cashier', [BY], 'Kassir', false);
  addStaff('laborant', M.lab, 'Gulnora Saidova', 'lab', [BC, BY], 'Laboratoriya operatori', true);

  // doctors: index, name, specialty, share, branch by weekday (0=Sun..6=Sat), room key, off days
  const DOCS = [
    { name: 'Akmal Rasulov', spec: 'Terapevt', share: 30, branch: (wd: number) => (wd === 2 || wd === 4 ? BY : BC), room: 'r101', off: [] as number[] },
    { name: 'Feruza Mirzayeva', spec: 'Kardiolog', share: 30, branch: () => BC, room: 'r102', off: [] },
    { name: 'Bekzod Ergashev', spec: 'Nevrolog', share: 30, branch: () => BC, room: 'r103', off: [6] },
    { name: 'Zarina Xolmatova', spec: 'Pediatr', share: 30, branch: () => BY, room: 'r201', off: [] },
    { name: 'Lola Abdullayeva', spec: 'Ginekolog', share: 30, branch: () => BY, room: 'r202', off: [1] },
    { name: 'Sardor Nazarov', spec: 'Endokrinolog', share: 30, branch: (wd: number) => (wd === 6 ? BC : BY), room: 'r203', off: [] },
    { name: 'Kamola Ismoilova', spec: 'UZI mutaxassisi', share: 25, branch: () => BC, room: 'r104', off: [] },
    { name: 'Otabek Qodirov', spec: 'Laboratoriya mutaxassisi', share: 10, branch: () => BC, room: 'r105', off: [] },
  ];
  DOCS.forEach((d, i) => {
    const branches = Array.from(new Set([0, 1, 2, 3, 4, 5, 6].map((wd) => d.branch(wd))));
    addStaff(`shifokor${i + 1}`, M.doctor(i), d.name, 'doctor', branches, d.spec, true);
    data.doctors.push({ id: SEED_IDS.doctor(i), tenant_id: T, membership_id: M.doctor(i), display_name: d.name, specialty: d.spec,
      phone: `+99871200${String(10 + i).padStart(4, '0')}`, default_share_percent: d.share, active: true, created_at: createdBase });
  });

  // ---------- rooms ----------
  const ROOMS: [string, string, string, string][] = [
    ['r101', BC, '101-xona', 'Terapiya'], ['r102', BC, '102-xona', 'Kardiologiya'], ['r103', BC, '103-xona', 'Nevrologiya'],
    ['r104', BC, '104-xona', 'UZI'], ['r105', BC, '105-xona', 'Laboratoriya'],
    ['r201', BY, '201-xona', 'Pediatriya'], ['r202', BY, '202-xona', 'Ginekologiya'], ['r203', BY, '203-xona', 'Endokrinologiya'],
  ];
  const roomBranch: Record<string, string> = {};
  for (const [k, b, n, p] of ROOMS) { data.rooms.push({ id: sid('room:' + k), tenant_id: T, branch_id: b, name: n, purpose: p }); roomBranch[k] = b; }

  // ---------- schedules ----------
  const WORK = { weekday: { start: '08:00', end: '18:00', bs: '13:00', be: '14:00' }, sunday: { start: '08:00', end: '17:00', bs: '13:00', be: '13:30' } };
  const schedOf: Record<string, Row> = {};
  DOCS.forEach((d, i) => {
    for (let wd = 0; wd < 7; wd++) {
      if (d.off.includes(wd)) continue;
      const w = wd === 0 ? WORK.sunday : WORK.weekday;
      const branch = d.branch(wd);
      const roomId = roomBranch[d.room] === branch ? sid('room:' + d.room) : null;
      const row = { id: sid(`sched:${i}:${wd}`), tenant_id: T, doctor_id: SEED_IDS.doctor(i), branch_id: branch, room_id: roomId,
        weekday: wd, start_time: w.start, end_time: w.end, break_start: w.bs, break_end: w.be };
      data.schedules.push(row);
      schedOf[`${i}:${wd}`] = row;
    }
  });

  // ---------- services ----------
  const tpl = (rows: [string, string, string, number | null, number | null, string?][]) =>
    rows.map(([code, name, unit, low, high, text]) => ({ code, name, unit, ref_low: low, ref_high: high, ref_text: text ?? null }));
  const SERVICES: { code: string; name: string; cat: string; dur: number; price: number; share: number; template?: any }[] = [
    { code: 'C01', name: 'Terapevt konsultatsiyasi', cat: 'consultation', dur: 30, price: 150_000, share: 30 },
    { code: 'C02', name: 'Terapevt qayta ko‘rigi', cat: 'consultation', dur: 20, price: 100_000, share: 30 },
    { code: 'C03', name: 'Kardiolog konsultatsiyasi', cat: 'consultation', dur: 30, price: 220_000, share: 30 },
    { code: 'C04', name: 'Kardiolog qayta ko‘rigi', cat: 'consultation', dur: 20, price: 150_000, share: 30 },
    { code: 'C05', name: 'Nevrolog konsultatsiyasi', cat: 'consultation', dur: 30, price: 200_000, share: 30 },
    { code: 'C06', name: 'Pediatr konsultatsiyasi', cat: 'consultation', dur: 30, price: 160_000, share: 30 },
    { code: 'C07', name: 'Ginekolog konsultatsiyasi', cat: 'consultation', dur: 30, price: 200_000, share: 30 },
    { code: 'C08', name: 'Endokrinolog konsultatsiyasi', cat: 'consultation', dur: 30, price: 210_000, share: 30 },
    { code: 'L01', name: 'Umumiy qon tahlili (UQT)', cat: 'lab', dur: 10, price: 60_000, share: 10, template: tpl([
      ['HGB', 'Gemoglobin', 'g/L', 120, 160], ['RBC', 'Eritrotsitlar', '×10¹²/L', 3.9, 5.5], ['WBC', 'Leykotsitlar', '×10⁹/L', 4.0, 9.0],
      ['PLT', 'Trombotsitlar', '×10⁹/L', 150, 400], ['ESR', 'EChT', 'mm/soat', 2, 15]]) },
    { code: 'L02', name: 'Bioximik qon tahlili', cat: 'lab', dur: 10, price: 120_000, share: 10, template: tpl([
      ['ALT', 'ALT', 'U/L', 0, 40], ['AST', 'AST', 'U/L', 0, 40], ['CREA', 'Kreatinin', 'µmol/L', 62, 115], ['UREA', 'Mochevina', 'mmol/L', 2.5, 8.3]]) },
    { code: 'L03', name: 'Qondagi glyukoza', cat: 'lab', dur: 10, price: 30_000, share: 10, template: tpl([['GLU', 'Glyukoza (och qoringa)', 'mmol/L', 3.9, 6.1]]) },
    { code: 'L04', name: 'Glikirlangan gemoglobin (HbA1c)', cat: 'lab', dur: 10, price: 90_000, share: 10, template: tpl([['HBA1C', 'HbA1c', '%', 4.0, 6.0]]) },
    { code: 'L05', name: 'Lipid profil', cat: 'lab', dur: 10, price: 110_000, share: 10, template: tpl([
      ['CHOL', 'Umumiy xolesterin', 'mmol/L', 3.0, 5.2], ['LDL', 'LDL', 'mmol/L', 0, 3.0], ['HDL', 'HDL', 'mmol/L', 1.0, 2.2], ['TG', 'Triglitseridlar', 'mmol/L', 0, 1.7]]) },
    { code: 'L06', name: 'TTG (tireotrop gormon)', cat: 'lab', dur: 10, price: 85_000, share: 10, template: tpl([['TSH', 'TTG', 'mIU/L', 0.4, 4.0]]) },
    { code: 'L07', name: 'Umumiy siydik tahlili', cat: 'lab', dur: 10, price: 45_000, share: 10, template: tpl([
      ['SG', 'Solishtirma og‘irlik', '', 1.005, 1.03], ['PH', 'pH', '', 5.0, 7.0], ['PRO', 'Oqsil', 'g/L', 0, 0.14]]) },
    { code: 'L08', name: 'Koagulogramma', cat: 'lab', dur: 10, price: 95_000, share: 10, template: tpl([['PT', 'Protrombin vaqti', 's', 11, 15], ['INR', 'XNM (INR)', '', 0.8, 1.2]]) },
    { code: 'L09', name: 'Ferritin', cat: 'lab', dur: 10, price: 80_000, share: 10, template: tpl([['FER', 'Ferritin', 'ng/mL', 15, 150]]) },
    { code: 'L10', name: 'D vitamini (25-OH)', cat: 'lab', dur: 10, price: 150_000, share: 10, template: tpl([['VITD', '25-OH D vitamini', 'ng/mL', 30, 100]]) },
    { code: 'U01', name: 'Qorin bo‘shlig‘i UZI', cat: 'ultrasound', dur: 30, price: 180_000, share: 25 },
    { code: 'U02', name: 'Qalqonsimon bez UZI', cat: 'ultrasound', dur: 20, price: 140_000, share: 25 },
    { code: 'U03', name: 'Buyrak va siydik yo‘llari UZI', cat: 'ultrasound', dur: 20, price: 150_000, share: 25 },
    { code: 'U04', name: 'Kichik chanoq a’zolari UZI', cat: 'ultrasound', dur: 30, price: 170_000, share: 25 },
    { code: 'U05', name: 'Exokardiografiya (EXO-KG)', cat: 'ultrasound', dur: 30, price: 250_000, share: 25 },
    { code: 'U06', name: 'Sut bezlari UZI', cat: 'ultrasound', dur: 20, price: 160_000, share: 25 },
    { code: 'U07', name: 'Homiladorlik UZI', cat: 'ultrasound', dur: 30, price: 190_000, share: 25 },
    { code: 'P01', name: 'Elektrokardiografiya (EKG)', cat: 'procedure', dur: 15, price: 70_000, share: 20 },
    { code: 'P02', name: 'Mushak ichiga in’ektsiya', cat: 'procedure', dur: 10, price: 30_000, share: 20 },
    { code: 'P03', name: 'Tomir ichiga tomchi (kapelnitsa)', cat: 'procedure', dur: 40, price: 90_000, share: 20 },
    { code: 'P04', name: 'Bog‘lam qo‘yish', cat: 'procedure', dur: 15, price: 40_000, share: 20 },
    { code: 'P05', name: 'Spirometriya', cat: 'procedure', dur: 20, price: 100_000, share: 20 },
  ];
  const svc: Record<string, Row> = {};
  const priceHistoryChangeDay = addDays(demoDate, -10);
  for (const s of SERVICES) {
    const row = { id: sid('service:' + s.code), tenant_id: T, code: s.code, name: s.name, category: s.cat, duration_min: s.dur,
      share_percent: s.share, lab_template: s.template ?? null, active: true, created_at: createdBase, updated_at: createdBase };
    data.services.push(row);
    svc[s.code] = { ...row, price: s.price };
    if (s.code === 'L01') {
      // price history: snapshot demo — older invoices keep 55 000, new orders use 60 000
      data.service_prices.push({ tenant_id: T, service_id: row.id, branch_id: null, amount: 55_000 * SO, valid_from: createdBase });
      data.service_prices.push({ tenant_id: T, service_id: row.id, branch_id: null, amount: s.price * SO, valid_from: at(priceHistoryChangeDay, 0) });
    } else {
      data.service_prices.push({ tenant_id: T, service_id: row.id, branch_id: null, amount: s.price * SO, valid_from: createdBase });
    }
  }
  // one inactive (historic) service is part of the 30? keep all 30 active; inactive flag is demonstrated via settings.
  const priceAt = (code: string, when: Date) => (code === 'L01' && when < at(priceHistoryChangeDay, 0) ? 55_000 : svc[code].price) * SO;

  const DOC_SERVICES: string[][] = [
    ['C01', 'C02', 'P01', 'P02', 'P03', 'P04', 'P05'],
    ['C03', 'C04', 'P01'],
    ['C05', 'P02'],
    ['C06', 'P02', 'P04'],
    ['C07'],
    ['C08'],
    ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07'],
    ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10'],
  ];
  DOC_SERVICES.forEach((codes, i) => codes.forEach((c) => data.doctor_services.push({ tenant_id: T, doctor_id: SEED_IDS.doctor(i), service_id: svc[c].id })));

  // ---------- patients ----------
  const MALE = ['Aziz', 'Sherzod', 'Jasur', 'Bekzod', 'Otabek', 'Sardor', 'Doniyor', 'Jahongir', 'Rustam', 'Ulug‘bek', 'Farrux', 'Akmal', 'Bobur', 'Islom', 'Temur', 'Anvar', 'Dilshod', 'Javohir', 'Shohruh', 'Elyor', 'Nodir', 'Sanjar', 'Umid', 'Xurshid', 'Alisher'];
  const FEMALE = ['Nilufar', 'Gulchehra', 'Malika', 'Dilnoza', 'Zarina', 'Madina', 'Shahnoza', 'Feruza', 'Kamola', 'Lola', 'Sevara', 'Munisa', 'Nargiza', 'Ozoda', 'Dildora', 'Mohira', 'Yulduz', 'Sabina', 'Barno', 'Hilola', 'Iroda', 'Umida', 'Zuhra', 'Charos', 'Gulbahor'];
  const SURN = ['Karimov', 'Umarov', 'Nurmatov', 'Tursunov', 'Rahimov', 'Yusupov', 'Aliyev', 'Ismoilov', 'Qodirov', 'Ergashev', 'Xolmatov', 'Abdullayev', 'Nazarov', 'Saidov', 'Mirzayev', 'Rasulov', 'Hasanov', 'Sobirov', 'Jo‘rayev', 'Mahmudov', 'Usmonov', 'Qosimov', 'Sultonov', 'Ahmedov', 'Haydarov', 'Normatov', 'Boboyev', 'Fayzullayev', 'Salimov', 'Valiyev'];
  const STREETS = ['Chilonzor', 'Yunusobod', 'Mirzo Ulug‘bek', 'Yakkasaroy', 'Shayxontohur', 'Olmazor', 'Sergeli', 'Uchtepa', 'Mirobod', 'Bektemir'];
  const ALLERGENS = ['Penitsillin', 'Aspirin', 'Yong‘oq', 'Changlanish (mavsumiy)', 'Lidokain', 'Sulfanilamidlar'];
  const usedPhones = new Set<string>();
  const phoneGen = () => {
    for (;;) {
      const p = `+998${pick(['90', '91', '93', '94', '97', '99', '33', '88'])}${String(int(0, 9999999)).padStart(7, '0')}`;
      if (!usedPhones.has(p)) { usedPhones.add(p); return p; }
    }
  };
  const demoYear = Number(demoDate.slice(0, 4));
  const birth = (age: number) => `${demoYear - age}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
  const ageOf = (b: string) => { const [y, m, d] = b.split('-').map(Number); const [cy, cm, cd] = demoDate.split('-').map(Number); return cy - y - (cm < m || (cm === m && cd < d) ? 1 : 0); };

  const FAMILY_PHONE = '+998901112233';
  usedPhones.add(FAMILY_PHONE);
  const FIXED: Partial<Row>[] = [
    { last_name: 'Karimov', first_name: 'Aziz', middle_name: 'Rustam o‘g‘li', birth_date: '1979-03-12', sex: 'male', allergy_state: 'known', allergy_note: 'Penitsillin — toshma (bemor so‘zidan)', note: 'Qayta keluvchi bemor' },
    { last_name: 'Tursunova', first_name: 'Nilufar', middle_name: 'Anvar qizi', birth_date: '1988-07-02', sex: 'female', phone: FAMILY_PHONE, allergy_state: 'denied' },
    { last_name: 'Tursunova', first_name: 'Madina', middle_name: 'Jasur qizi', birth_date: '2018-04-15', sex: 'female', phone: FAMILY_PHONE, contact_name: 'Tursunova Nilufar (onasi)', contact_phone: FAMILY_PHONE, allergy_state: 'unknown' },
    { last_name: 'Umarov', first_name: 'Sherzod', middle_name: 'Dilshod o‘g‘li', birth_date: '1985-11-23', sex: 'male', allergy_state: 'denied' },
    { last_name: 'Nurmatova', first_name: 'Gulchehra', middle_name: 'Islom qizi', birth_date: '1962-01-30', sex: 'female', allergy_state: 'unknown' },
  ];
  const patients: Row[] = data.patients;
  for (let i = 0; i < 100; i++) {
    const f = FIXED[i];
    let row: Row;
    if (f) {
      row = { ...f };
      if (!row.phone) row.phone = phoneGen();
    } else {
      const sex = chance(0.5) ? 'male' : 'female';
      const r = rnd();
      const age = r < 0.18 ? int(1, 17) : r < 0.75 ? int(18, 59) : int(60, 86);
      const sur = pick(SURN);
      const father = pick(MALE);
      row = {
        last_name: sex === 'male' ? sur : sur + 'a',
        first_name: sex === 'male' ? pick(MALE) : pick(FEMALE),
        middle_name: chance(0.8) ? `${father} ${sex === 'male' ? 'o‘g‘li' : 'qizi'}` : null,
        birth_date: birth(age), sex,
        phone: age < 14 && chance(0.6) ? null : chance(0.92) ? phoneGen() : null,
        allergy_state: chance(0.15) ? 'known' : chance(0.55) ? 'denied' : 'unknown',
      };
      if (row.allergy_state === 'known') row.allergy_note = pick(ALLERGENS);
      if (age < 14) { row.contact_name = `${sur}${chance(0.5) ? 'a' : ''} ${chance(0.5) ? pick(FEMALE) : pick(MALE)} (ota-onasi)`; row.contact_phone = phoneGen(); }
    }
    const created = new Date(createdBase.getTime() + i * 3600_000 * 7);
    patients.push({
      id: SEED_IDS.patient(i), tenant_id: T, patient_number: 1001 + i,
      last_name: row.last_name, first_name: row.first_name, middle_name: row.middle_name ?? null,
      birth_date: row.birth_date, sex: row.sex, phone: row.phone ?? null,
      contact_name: row.contact_name ?? null, contact_phone: row.contact_phone ?? null,
      address: `Toshkent sh., ${pick(STREETS)} tumani (demo)`, note: row.note ?? null,
      allergy_state: row.allergy_state, allergy_note: row.allergy_note ?? null, created_at: created, updated_at: created,
    });
  }
  const pAge = (i: number) => ageOf(patients[i].birth_date);
  const childPool = patients.map((_, i) => i).filter((i) => i >= 5 && pAge(i) < 18);
  const adultPool = patients.map((_, i) => i).filter((i) => i >= 5 && pAge(i) >= 18);
  const womenPool = adultPool.filter((i) => patients[i].sex === 'female' && pAge(i) < 70);
  // ~12 adults never visited ("yangi") — they are excluded from the appointment pool
  const neverVisited = new Set(adultPool.slice(-12));
  const adultsActive = adultPool.filter((i) => !neverVisited.has(i));
  const womenActive = womenPool.filter((i) => !neverVisited.has(i));
  const poolFor = (doc: number) => (doc === 3 ? childPool : doc === 4 ? womenActive : adultsActive);

  // ---------- appointment planning ----------
  type Plan = { doc: number; patient: number; date: string; start: number; svc: string; status: string; fixedKey?: string };
  const occupied: Record<string, [number, number][]> = {};
  const free = (doc: number, date: string, s: number, e: number) => !(occupied[`${doc}:${date}`] || []).some(([a, b]) => s < b && a < e);
  const occupy = (doc: number, date: string, s: number, e: number) => { (occupied[`${doc}:${date}`] ||= []).push([s, e]); };
  const plans: Plan[] = [];
  const primaryFor = (doc: number, returning: boolean) => {
    const opts: Record<number, string[]> = { 0: returning ? ['C02', 'C01'] : ['C01', 'C01', 'C02'], 1: returning ? ['C04'] : ['C03', 'C03', 'C04'], 2: ['C05'], 3: ['C06'], 4: ['C07'], 5: ['C08'], 6: ['U01', 'U02', 'U03', 'U04', 'U05', 'U06'] };
    return pick(opts[doc]);
  };
  const addPlan = (p: Plan) => { const dur = svc[p.svc].duration_min; occupy(p.doc, p.date, p.start, p.start + dur); plans.push(p); };
  const placeRandom = (doc: number, date: string, svcCode: string): number | null => {
    const wd = weekdayOf(date);
    const sch = schedOf[`${doc}:${wd}`];
    if (!sch) return null;
    const dur = svc[svcCode].duration_min;
    const s0 = hm(sch.start_time), e0 = hm(sch.end_time), bs = hm(sch.break_start), be = hm(sch.break_end);
    const slots: number[] = [];
    for (let t = s0; t + dur <= e0; t += 30) if (!(t < be && bs < t + dur) && free(doc, date, t, t + dur)) slots.push(t);
    return slots.length ? pick(slots) : null;
  };

  // Today (demo date): exact composition 8 scheduled, 7 arrived, 3 in_progress, 10 completed, 1 cancelled, 1 no_show
  const TODAY: [number, string, string, string, number?][] = [
    // doc, time, status, service, fixed patient
    [0, '08:00', 'completed', 'C01'], [0, '08:30', 'completed', 'C01'], [0, '09:00', 'completed', 'C01', 4],
    [0, '09:30', 'no_show', 'C01'], [0, '10:00', 'in_progress', 'C01'], [0, '10:30', 'arrived', 'C02', 0], [0, '11:00', 'arrived', 'C01'],
    [1, '08:00', 'completed', 'C03'], [1, '08:30', 'completed', 'C04'], [1, '09:00', 'in_progress', 'C03'], [1, '10:00', 'arrived', 'C03'], [1, '14:00', 'scheduled', 'C03'],
    [2, '08:30', 'completed', 'C05'], [2, '10:30', 'arrived', 'C05'], [2, '11:30', 'scheduled', 'C05'], [2, '15:00', 'scheduled', 'C05'],
    [3, '08:00', 'completed', 'C06'], [3, '09:00', 'cancelled', 'C06'], [3, '10:30', 'arrived', 'C06', 2], [3, '11:30', 'scheduled', 'C06'],
    [4, '09:00', 'completed', 'C07'], [4, '10:30', 'arrived', 'C07'], [4, '12:00', 'scheduled', 'C07'], [4, '14:30', 'scheduled', 'C07'],
    [5, '08:30', 'completed', 'C08'], [5, '10:00', 'arrived', 'C08', 3], [5, '12:00', 'scheduled', 'C08'], [5, '15:30', 'scheduled', 'C08'],
    [6, '08:00', 'completed', 'U02'], [6, '10:00', 'in_progress', 'U01'],
  ];
  const usedToday = new Set<number>([0, 2, 3, 4]);
  for (const [doc, time, status, code, fixed] of TODAY) {
    let patient = fixed;
    if (patient === undefined) {
      const pool = poolFor(doc).filter((i) => !usedToday.has(i));
      patient = pick(pool);
    }
    usedToday.add(patient);
    addPlan({ doc, patient, date: demoDate, start: hm(time), svc: code, status });
  }

  // Returning patient Aziz Karimov: 3 earlier visits
  addPlan({ doc: 0, patient: 0, date: addDays(demoDate, -25), start: hm('09:00'), svc: 'C01', status: 'completed', fixedKey: 'aziz1' });
  addPlan({ doc: 1, patient: 0, date: addDays(demoDate, -14), start: hm('11:00'), svc: 'C03', status: 'completed', fixedKey: 'aziz2' });
  addPlan({ doc: 0, patient: 0, date: addDays(demoDate, -4), start: hm('10:00'), svc: 'C02', status: 'completed', fixedKey: 'aziz3' });
  // Nilufar (mother) one visit with gynecologist; Madina one with pediatrician
  addPlan({ doc: 4, patient: 1, date: addDays(demoDate, -9), start: hm('10:00'), svc: 'C07', status: 'completed' });
  addPlan({ doc: 3, patient: 2, date: addDays(demoDate, -20), start: hm('09:00'), svc: 'C06', status: 'completed' });
  // Cardiologist encounter that orders an echo (UZI order from consultation)
  addPlan({ doc: 1, patient: adultsActive[3], date: addDays(demoDate, -6), start: hm('09:30'), svc: 'C03', status: 'completed', fixedKey: 'echoOrder' });

  // Past: total 190 = 160 completed, 15 cancelled, 15 no_show. 9 of the completed are UZI appointments.
  const pastTarget = { completed: 160, cancelled: 15, no_show: 15 };
  const pastCount = () => plans.filter((p) => p.date < demoDate).reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {} as Record<string, number>);
  let uziPast = 0;
  const docWeights = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5];
  let guard = 0;
  while (guard++ < 5000) {
    const c = pastCount();
    const need = (Object.keys(pastTarget) as (keyof typeof pastTarget)[]).filter((k) => (c[k] || 0) < pastTarget[k]);
    if (!need.length) break;
    const status = pick(need);
    const doc = status === 'completed' && uziPast < 9 && chance(0.12) ? 6 : pick(docWeights);
    const date = addDays(demoDate, -int(1, 29));
    const pool = poolFor(doc);
    const patient = pick(pool);
    const code = primaryFor(doc, chance(0.3));
    const start = placeRandom(doc, date, code);
    if (start === null) continue;
    if (doc === 6) uziPast++;
    addPlan({ doc, patient, date, start, svc: code, status });
  }
  while (uziPast < 9) { // guarantee 9 past UZI appointments
    const date = addDays(demoDate, -int(1, 29));
    const code = primaryFor(6, false);
    const start = placeRandom(6, date, code);
    if (start === null) continue;
    // convert one random past non-UZI completed into this UZI visit to keep totals
    const idx = plans.findIndex((p) => p.date < demoDate && p.status === 'completed' && p.doc !== 6 && !p.fixedKey && p.patient > 4);
    plans.splice(idx, 1);
    addPlan({ doc: 6, patient: pick(adultsActive), date, start, svc: code, status: 'completed' });
    uziPast++;
  }

  // Future: 20 scheduled over next 6 days
  let fut = 0;
  while (fut < 20) {
    const doc = pick([0, 0, 1, 1, 2, 3, 3, 4, 5, 6]);
    const date = addDays(demoDate, int(1, 6));
    const code = primaryFor(doc, false);
    const start = placeRandom(doc, date, code);
    if (start === null) continue;
    addPlan({ doc, patient: pick(poolFor(doc)), date, start, svc: code, status: 'scheduled' });
    fut++;
  }

  plans.sort((a, b) => (a.date + String(a.start).padStart(4, '0')).localeCompare(b.date + String(b.start).padStart(4, '0')) || a.doc - b.doc);

  // ---------- build appointments and everything that hangs off them ----------
  const NOTE_TEMPLATES: Record<number, { c: string; a: string; e: string; d: string; r: string }[]> = {
    0: [
      { c: 'Tomoq og‘rig‘i, burun bitishi, 37.6°C gacha harorat 2 kundan beri.', a: 'Kasallik o‘tkir boshlangan, oilada shamollash holatlari bor.', e: 'Tomoq shilliq qavati qizargan, o‘pkada vezikulyar nafas.', d: 'O‘tkir respirator infeksiya (demo)', r: 'Ko‘p suyuqlik, dam olish. 5 kundan keyin ahvol yaxshilanmasa qayta murojaat.' },
      { c: 'Umumiy holsizlik, tez charchash.', a: '1 oydan beri, ish yuklamasi oshgan.', e: 'Teri qoplamlari rangpar, AQB me’yorida.', d: 'Holsizlik sindromi, tekshiruv davom etadi (demo)', r: 'UQT va ferritin tahlili. Natija bilan qayta ko‘rik.' },
      { c: 'Bosh og‘rig‘i, bosh aylanishi.', a: 'Kechqurunlari kuchayadi, qon bosimi o‘lchanmagan.', e: 'AQB 145/90, puls ritmik.', d: 'Arterial gipertenziya shubhasi (demo)', r: 'Uyda AQB kundaligi yuritish, kardiolog konsultatsiyasi.' },
    ],
    1: [
      { c: 'Yurak sohasida vaqti-vaqti bilan sanchiq.', a: 'Jismoniy yuklamadan keyin, 2 haftadan beri.', e: 'Yurak tonlari aniq, ritmik. AQB 135/85.', d: 'Kardialgiya, tekshiruv rejalashtirildi (demo)', r: 'EKG, lipid profil. Qayta ko‘rik 2 haftadan keyin.' },
      { c: 'Yurak urishi tezlashishi.', a: 'Stress fonida, kofe iste’moli ko‘p.', e: 'Puls 92, ritmik.', d: 'Sinusli taxikardiya (demo)', r: 'Kofeinni kamaytirish, uyqu rejimi.' },
    ],
    2: [
      { c: 'Bo‘yin va yelkada og‘riq.', a: 'Kompyuterda uzoq ishlash, 3 haftadan beri.', e: 'Bo‘yin mushaklarida taranglik.', d: 'Bo‘yin osteoxondrozi belgilari (demo)', r: 'Ish joyi ergonomikasi, mashqlar majmuasi.' },
      { c: 'Uyqusizlik, bosh og‘rig‘i.', a: 'Bir oydan beri.', e: 'Nevrologik status o‘zgarishsiz.', d: 'Kuchlanish tipidagi bosh og‘rig‘i (demo)', r: 'Uyqu gigiyenasi, 1 oydan keyin nazorat.' },
    ],
    3: [
      { c: 'Yo‘tal, harorat 38°C.', a: 'Bolalar bog‘chasida shamollash holatlari.', e: 'Tomoq qizargan, o‘pkada quruq xirillashlar yo‘q.', d: 'O‘tkir respirator infeksiya (demo)', r: 'Iliq suyuqlik, harorat nazorati. 3 kundan keyin ko‘rik.' },
      { c: 'Rejalashtirilgan profilaktik ko‘rik.', a: 'Shikoyat yo‘q.', e: 'Yoshiga mos rivojlangan.', d: 'Sog‘lom bola (demo)', r: 'Keyingi profilaktik ko‘rik 6 oydan keyin.' },
    ],
    4: [
      { c: 'Profilaktik ko‘rik.', a: 'Shikoyat yo‘q.', e: 'Patologik o‘zgarish aniqlanmadi.', d: 'Profilaktik ko‘rik, patologiya aniqlanmadi (demo)', r: 'Yillik ko‘rik.' },
      { c: 'Qorin pastida og‘riq.', a: 'Bir haftadan beri.', e: 'Palpatsiyada sezilarli og‘riq yo‘q.', d: 'Tekshiruv talab etiladi (demo)', r: 'Kichik chanoq UZI, natija bilan qayta ko‘rik.' },
    ],
    5: [
      { c: 'Chanqash, tez-tez siyish.', a: '2 oydan beri, oilada qandli diabet bor.', e: 'Tana vazni indeksi 31.', d: 'Uglevod almashinuvi buzilishi shubhasi (demo)', r: 'Glyukoza, HbA1c. Ovqatlanish kundaligi.' },
      { c: 'Holsizlik, vazn ortishi.', a: '6 oy davomida 5 kg.', e: 'Qalqonsimon bez paypaslanmaydi.', d: 'Gipotireoz shubhasi (demo)', r: 'TTG tahlili, qalqonsimon bez UZI.' },
    ],
    6: [
      { c: 'Yo‘llanma bo‘yicha UZI tekshiruvi.', a: 'Shifokor yo‘llanmasi.', e: 'UZI o‘tkazildi.', d: 'UZI tekshiruvi o‘tkazildi — xulosa «Diagnostika» bo‘limida (demo)', r: 'Natija bilan davolovchi shifokorga murojaat.' },
    ],
  };
  const UZI_TEXT: Record<string, { d: string; c: string }> = {
    U01: { d: 'Jigar o‘lchami me’yorda, exostruktura bir xil. O‘t pufagi devori yupqa, toshlar aniqlanmadi. Oshqozon osti bezi va taloq o‘zgarishsiz.', c: 'Qorin bo‘shlig‘i a’zolarida exografik patologiya aniqlanmadi (demo).' },
    U02: { d: 'O‘ng bo‘lak 15×16×45 mm, chap bo‘lak 14×15×44 mm. Exostruktura bir xil, tugunlar aniqlanmadi.', c: 'Qalqonsimon bez exografik me’yorda (demo).' },
    U03: { d: 'Buyraklar odatiy joylashgan, o‘lchamlari me’yorda. Kosacha-jom tizimi kengaymagan.', c: 'Buyraklarda exografik patologiya aniqlanmadi (demo).' },
    U04: { d: 'Bachadon o‘lchamlari me’yorda, endometriy sikl fazasiga mos. Tuxumdonlar odatiy.', c: 'Kichik chanoq a’zolarida exografik patologiya aniqlanmadi (demo).' },
    U05: { d: 'Yurak bo‘shliqlari kengaymagan. CHQ qisqaruvchanligi saqlangan, EF 62%. Klapanlar o‘zgarishsiz.', c: 'Exokardiografik ko‘rsatkichlar me’yor doirasida (demo).' },
    U06: { d: 'Sut bezlari to‘qimasi yoshga mos. Hajmli hosilalar aniqlanmadi.', c: 'Sut bezlarida exografik patologiya aniqlanmadi (demo).' },
    U07: { d: 'Bachadonda bitta homila, yurak urishi aniqlanadi.', c: 'Homiladorlik muddatiga mos (demo).' },
  };

  const cashierFor = (branch: string) => (branch === BC ? { id: M.cashier, name: 'Nodira Aliyeva' } : { id: M.cashier2, name: 'Jasur Toshmatov' });
  const registrarFor = (branch: string) => (branch === BC ? { id: M.registrar, name: 'Malika Yusupova' } : { id: M.registrar2, name: 'Shahzod Rahimov' });
  const audit = (when: Date, branch: string | null, actorId: string | null, actorName: string, role: string, action: string, type: string, id: string, summary: string) =>
    data.audit_logs.push({ tenant_id: T, branch_id: branch, actor_membership_id: actorId, actor_name: actorName, actor_role: role, action, resource_type: type, resource_id: id, summary, request_id: 'seed', occurred_at: when });

  type Visit = { plan: Plan; apptId: string; branch: string; start: Date; end: Date; encounterId?: string; invoiceKey?: string; orders: Row[] };
  const visits: Visit[] = [];
  const queueByBranchDate: Record<string, { apptId: string; arrived: Date; started: Date | null; finished: Date | null; branch: string; date: string }[]> = {};

  plans.forEach((p, idx) => {
    const wd = weekdayOf(p.date);
    const sch = schedOf[`${p.doc}:${wd}`];
    const branch = sch.branch_id;
    const dur = svc[p.svc].duration_min;
    const start = at(p.date, p.start);
    const end = at(p.date, p.start + dur);
    const apptId = sid(`appt:${p.fixedKey ?? `${p.date}:${p.doc}:${p.start}`}`);
    // Bookings are always made before the demo day starts (never "created in the future").
    const createdAt = new Date(Math.min(start.getTime() - (p.date === demoDate ? int(1, 4) : int(1, 7)) * 86400_000 - int(0, 480) * 60_000,
      at(demoDate, hm('07:30')).getTime() - int(1, 600) * 60_000));
    const reg = registrarFor(branch);
    data.appointments.push({
      id: apptId, tenant_id: T, branch_id: branch, patient_id: patients[p.patient].id, doctor_id: SEED_IDS.doctor(p.doc),
      service_id: svc[p.svc].id, room_id: sch.room_id, starts_at: start, ends_at: end, status: p.status,
      note: idx % 9 === 0 ? 'Telefon orqali yozildi' : null,
      cancel_reason: p.status === 'cancelled' ? pick(['Bemor iltimosi bilan', 'Bemor boshqa kunga ko‘chirishni so‘radi', 'Shifokor kasalligi tufayli']) : null,
      version: 1, created_by: reg.id, created_at: createdAt, updated_at: createdAt,
    });
    if (idx % 4 === 0) audit(createdAt, branch, reg.id, reg.name, 'registrar', 'appointment.create', 'appointment', apptId, `${svc[p.svc].name}, ${p.date}`);
    const v: Visit = { plan: p, apptId, branch, start, end, orders: [] };
    visits.push(v);
    if (['arrived', 'in_progress', 'completed'].includes(p.status)) {
      const arrived = new Date(start.getTime() - int(5, 20) * 60_000);
      const started = p.status === 'arrived' ? null : new Date(start.getTime() + int(0, 6) * 60_000);
      const finished = p.status === 'completed' ? end : null;
      (queueByBranchDate[`${branch}:${p.date}`] ||= []).push({ apptId, arrived, started, finished, branch, date: p.date });
      // primary order (booked service) is created at check-in
      const order = {
        id: sid(`order:primary:${apptId}`), tenant_id: T, branch_id: branch, patient_id: patients[p.patient].id, appointment_id: apptId, encounter_id: null as string | null,
        service_id: svc[p.svc].id, category: svc[p.svc].category, service_name: svc[p.svc].name, is_primary: true, price_snapshot: priceAt(p.svc, arrived),
        share_percent_snapshot: svc[p.svc].share_percent, doctor_id: SEED_IDS.doctor(p.doc), performer_doctor_id: SEED_IDS.doctor(p.doc),
        status: p.status === 'completed' ? 'completed' : 'ordered', ordered_at: arrived, performed_at: p.status === 'completed' ? end : null, created_by: reg.id,
      };
      v.orders.push(order);
      if (started) {
        const encId = sid(`enc:${apptId}`);
        v.encounterId = encId;
        order.encounter_id = encId;
        data.encounters.push({ id: encId, tenant_id: T, branch_id: branch, appointment_id: apptId, patient_id: patients[p.patient].id, doctor_id: SEED_IDS.doctor(p.doc),
          status: p.status === 'completed' ? 'closed' : 'open', started_at: started, closed_at: finished });
        const t = pick(NOTE_TEMPLATES[p.doc]);
        const vitals: Record<string, number> = p.doc === 6 ? {} : { bp_sys: int(110, 150), bp_dia: int(70, 95), pulse: int(62, 96), temp: Number((36.4 + rnd() * 1.4).toFixed(1)) };
        if (p.status === 'completed') {
          data.clinical_notes.push({ id: sid(`note:${encId}`), tenant_id: T, encounter_id: encId, complaints: t.c, anamnesis: t.a, examination: t.e, diagnosis: t.d,
            recommendations: t.r, follow_up_date: chance(0.3) ? addDays(p.date, 14) : null, vitals, status: 'signed', version: 2, saved_at: end,
            signed_by: M.doctor(p.doc), signed_by_name: DOCS[p.doc].name, signed_at: end });
          if (p.date >= addDays(demoDate, -7) || idx % 3 === 0) audit(end, branch, M.doctor(p.doc), DOCS[p.doc].name, 'doctor', 'clinical_note.sign', 'encounter', encId, 'Klinik qayd tasdiqlandi');
        } else {
          data.clinical_notes.push({ id: sid(`note:${encId}`), tenant_id: T, encounter_id: encId, complaints: t.c, anamnesis: t.a, examination: null, diagnosis: null,
            recommendations: null, follow_up_date: null, vitals: { bp_sys: vitals.bp_sys ?? null, bp_dia: vitals.bp_dia ?? null, pulse: null, temp: null }, status: 'draft', version: 1,
            saved_at: new Date(started.getTime() + 8 * 60_000), signed_by: null, signed_by_name: null, signed_at: null });
        }
      }
    }
  });
  // queue tickets: numbers per branch + local day in arrival order
  for (const [key, list] of Object.entries(queueByBranchDate)) {
    list.sort((a, b) => a.arrived.getTime() - b.arrived.getTime());
    list.forEach((q, i) => data.queue_tickets.push({ id: sid(`queue:${q.apptId}`), tenant_id: T, branch_id: q.branch, appointment_id: q.apptId, local_date: q.date, number: i + 1,
      arrived_at: q.arrived, started_at: q.started, finished_at: q.finished, wait_seconds: q.started ? Math.round((q.started.getTime() - q.arrived.getTime()) / 1000) : null }));
    data.queue_counters.push({ branch_id: list[0].branch, local_date: list[0].date, last_number: list.length });
    void key;
  }

  // ---------- extra orders: 24 lab, 1 UZI from consultation ----------
  const visitByKey = (k: string) => visits.find((v) => v.apptId === sid(`appt:${k}`))!;
  const todayVisits = visits.filter((v) => v.plan.date === demoDate);
  const todayDoc = (doc: number, time: string) => todayVisits.find((v) => v.plan.doc === doc && v.plan.start === hm(time))!;
  const pastCompletedNonUzi = visits.filter((v) => v.plan.date < demoDate && v.plan.status === 'completed' && v.plan.doc !== 6 && !v.plan.fixedKey);
  const labPlan: { v: Visit; code: string; status: string }[] = [];
  // verified 10 (past) — includes returning patient Aziz
  labPlan.push({ v: visitByKey('aziz1'), code: 'L01', status: 'verified' });
  const labCodesFor = (doc: number) => ({ 0: ['L01', 'L02', 'L09', 'L03'], 1: ['L05', 'L08', 'L02'], 2: ['L01', 'L10'], 3: ['L01', 'L07'], 4: ['L01', 'L07'], 5: ['L03', 'L04', 'L06'] } as Record<number, string[]>)[doc];
  const pastPicks = pastCompletedNonUzi.filter((_, i) => i % 11 === 3);
  for (let i = 0; labPlan.length < 10; i++) { const v = pastPicks[i]; labPlan.push({ v, code: pick(labCodesFor(v.plan.doc)), status: 'verified' }); }
  // draft_result 4: Gulchehra today (pending-lab scenario) + 3 recent
  labPlan.push({ v: todayDoc(0, '09:00'), code: 'L01', status: 'draft_result' });
  const recent = pastCompletedNonUzi.filter((v) => v.plan.date >= addDays(demoDate, -2));
  labPlan.push({ v: recent[0], code: pick(labCodesFor(recent[0].plan.doc)), status: 'draft_result' });
  labPlan.push({ v: recent[1], code: pick(labCodesFor(recent[1].plan.doc)), status: 'draft_result' });
  labPlan.push({ v: todayDoc(5, '08:30'), code: 'L04', status: 'draft_result' });
  // sample_collected 4
  labPlan.push({ v: todayDoc(0, '08:00'), code: 'L02', status: 'sample_collected' });
  labPlan.push({ v: todayDoc(1, '08:00'), code: 'L05', status: 'sample_collected' });
  labPlan.push({ v: todayDoc(2, '08:30'), code: 'L10', status: 'sample_collected' });
  labPlan.push({ v: recent[2], code: pick(labCodesFor(recent[2].plan.doc)), status: 'sample_collected' });
  // ordered 6
  labPlan.push({ v: todayDoc(0, '08:30'), code: 'L01', status: 'ordered' });
  labPlan.push({ v: todayDoc(0, '10:00'), code: 'L01', status: 'ordered' });
  labPlan.push({ v: todayDoc(0, '10:00'), code: 'L03', status: 'ordered' });
  labPlan.push({ v: todayDoc(1, '09:00'), code: 'L05', status: 'ordered' });
  labPlan.push({ v: todayDoc(1, '08:30'), code: 'L08', status: 'ordered' });
  labPlan.push({ v: todayDoc(4, '09:00'), code: 'L07', status: 'ordered' });

  const LAB_TECH = 'Gulnora Saidova';
  const valueFor = (p: any, abnormal: boolean) => {
    const lo = p.ref_low ?? 0, hi = p.ref_high ?? lo * 2 + 1;
    const span = hi - lo;
    let v = abnormal ? (chance(0.5) ? hi + span * (0.1 + rnd() * 0.3) : Math.max(lo * 0.6, lo - span * (0.05 + rnd() * 0.2))) : lo + span * (0.15 + rnd() * 0.7);
    const decimals = hi < 2 ? 3 : hi < 20 ? 1 : 0;
    v = Number(v.toFixed(decimals));
    return { code: p.code, name: p.name, unit: p.unit, ref_low: p.ref_low, ref_high: p.ref_high, value: String(v), flag: v < lo ? 'low' : v > hi ? 'high' : 'normal' };
  };
  labPlan.forEach((lp, i) => {
    const v = lp.v;
    const enc = v.encounterId!;
    const orderedAt = new Date(v.start.getTime() + 15 * 60_000);
    const s = svc[lp.code];
    const orderId = sid(`order:lab:${i}`);
    const verifiedAt = new Date(orderedAt.getTime() + int(2, 5) * 3600_000);
    v.orders.push({ id: orderId, tenant_id: T, branch_id: v.branch, patient_id: patients[v.plan.patient].id, appointment_id: v.apptId, encounter_id: enc,
      service_id: s.id, category: 'lab', service_name: s.name, is_primary: false, price_snapshot: priceAt(lp.code, orderedAt), share_percent_snapshot: s.share_percent,
      doctor_id: SEED_IDS.doctor(v.plan.doc), performer_doctor_id: SEED_IDS.doctor(7), status: lp.status, ordered_at: orderedAt,
      performed_at: lp.status === 'verified' ? verifiedAt : null, created_by: M.doctor(v.plan.doc) });
    if (lp.status !== 'ordered') {
      const collected = new Date(orderedAt.getTime() + int(10, 40) * 60_000);
      const values = lp.status === 'sample_collected' ? [] : (s.lab_template as any[]).map((p) => valueFor(p, chance(0.25)));
      data.lab_results.push({ id: sid(`labres:${orderId}`), tenant_id: T, order_id: orderId, values, comment: null,
        status: lp.status === 'verified' ? 'verified' : 'draft', collected_at: collected, collected_by_name: LAB_TECH,
        entered_by_name: lp.status === 'sample_collected' ? null : LAB_TECH, entered_at: lp.status === 'sample_collected' ? null : new Date(collected.getTime() + 3600_000),
        verified_by: lp.status === 'verified' ? M.lab : null, verified_by_name: lp.status === 'verified' ? LAB_TECH : null, verified_at: lp.status === 'verified' ? verifiedAt : null });
      if (lp.status === 'verified') audit(verifiedAt, v.branch, M.lab, LAB_TECH, 'lab', 'lab_result.verify', 'order', orderId, `${s.name} tasdiqlandi`);
    }
  });

  // UZI order from cardiologist consultation (echo)
  {
    const v = visitByKey('echoOrder');
    const s = svc['U05'];
    const orderedAt = new Date(v.start.getTime() + 20 * 60_000);
    const orderId = sid('order:uzi:echo');
    v.orders.push({ id: orderId, tenant_id: T, branch_id: v.branch, patient_id: patients[v.plan.patient].id, appointment_id: v.apptId, encounter_id: v.encounterId,
      service_id: s.id, category: 'ultrasound', service_name: s.name, is_primary: false, price_snapshot: priceAt('U05', orderedAt), share_percent_snapshot: s.share_percent,
      doctor_id: SEED_IDS.doctor(1), performer_doctor_id: SEED_IDS.doctor(6), status: 'completed', ordered_at: orderedAt, performed_at: new Date(orderedAt.getTime() + 3600_000), created_by: M.doctor(1) });
  }
  // diagnostic reports for every ultrasound order
  for (const v of visits) for (const o of v.orders) {
    if (o.category !== 'ultrasound') continue;
    const code = data.services.find((s) => s.id === o.service_id)!.code;
    const signed = o.status === 'completed';
    const when = signed ? (o.performed_at as Date) : new Date(v.start.getTime() + 15 * 60_000);
    const txt = UZI_TEXT[code];
    data.diagnostic_reports.push({ id: sid(`uzi:${o.id}`), tenant_id: T, order_id: o.id, template_version: 'uzi-v1', exam_type: o.service_name,
      description: txt.d, conclusion: signed ? txt.c : null, specialist_name: DOCS[6].name, status: signed ? 'signed' : 'draft',
      signed_by: signed ? M.doctor(6) : null, signed_at: signed ? when : null, updated_at: when });
  }

  // ---------- invoices, items, payments ----------
  const invoiceVisits = visits.filter((v) => v.orders.length > 0); // all checked-in visits
  // Desired statuses: past 160 -> 121 paid, 17 partial, 17 unpaid, 5 void; today 20 -> 9 paid, 3 partial, 8 unpaid
  const todayInv: Record<string, string> = {};
  const todayStatusByKey: [number, string, string][] = [
    [0, '08:00', 'paid'], [0, '08:30', 'paid'], [0, '09:00', 'paid'], [1, '08:00', 'paid'], [1, '08:30', 'partially_paid'], [2, '08:30', 'paid'],
    [3, '08:00', 'paid'], [4, '09:00', 'partially_paid'], [5, '08:30', 'paid'], [6, '08:00', 'unpaid'],
    [0, '10:00', 'unpaid'], [1, '09:00', 'unpaid'], [6, '10:00', 'unpaid'],
    [0, '10:30', 'unpaid'], [0, '11:00', 'paid'], [1, '10:00', 'paid'], [2, '10:30', 'unpaid'], [3, '10:30', 'unpaid'], [4, '10:30', 'unpaid'], [5, '10:00', 'partially_paid'],
  ];
  for (const [d, t, s] of todayStatusByKey) todayInv[todayDoc(d, t).apptId] = s;
  const pastVisits = invoiceVisits.filter((v) => v.plan.date < demoDate);
  const pastStatuses: string[] = [];
  for (let i = 0; i < pastVisits.length; i++) pastStatuses.push('paid');
  // deterministic spread of non-paid statuses over the past visits
  const order = pastVisits.map((_, i) => i).sort((a, b) => ((a * 37) % 160) - ((b * 37) % 160));
  let k = 0;
  const assign = (status: string, n: number, filter: (v: Visit) => boolean) => {
    let placed = 0;
    for (const i of order) { if (placed >= n) break; if (pastStatuses[i] !== 'paid' || !filter(pastVisits[i])) continue; pastStatuses[i] = status; placed++; k++; }
  };
  const isAziz = (key: string) => (v: Visit) => v.apptId === sid(`appt:${key}`);
  const notFixed = (v: Visit) => !v.plan.fixedKey && !v.orders.some((o) => o.category === 'lab' && o.status === 'verified' && false);
  assign('unpaid', 1, isAziz('aziz2')); // returning patient has one old open invoice (debt)
  assign('void', 5, (v) => notFixed(v) && v.orders.length === 1);
  assign('partially_paid', 17, notFixed);
  assign('unpaid', 16, notFixed);

  const methods = ['cash', 'cash', 'cash', 'card', 'card', 'transfer'];
  let invoiceSeq = 0, receiptSeq = 0;
  const invoiceTimeline: { inv: Row; v: Visit }[] = [];
  for (const v of invoiceVisits) {
    const status = v.plan.date === demoDate ? todayInv[v.apptId] : pastStatuses[pastVisits.indexOf(v)];
    v.orders.sort((a, b) => a.ordered_at.getTime() - b.ordered_at.getTime());
    const created = v.orders[0].ordered_at as Date;
    const invoiceId = sid(`invoice:${v.apptId}`);
    const items = v.orders.map((o, pos) => ({ id: sid(`item:${o.id}`), tenant_id: T, invoice_id: invoiceId, order_id: o.id, service_id: o.service_id, description: o.service_name,
      quantity: 1, unit_price: o.price_snapshot, line_subtotal: o.price_snapshot, discount_share: 0, line_total: o.price_snapshot, position: pos }));
    const subtotal = items.reduce((a, b) => a + b.line_subtotal, 0);
    let discount = 0; let discountType: string | null = null; let discountValue: number | null = null; let discountReason: string | null = null;
    if (status === 'paid' && invoiceSeq % 17 === 5) {
      discountType = 'percent'; discountValue = 10; discountReason = 'Doimiy bemor chegirmasi (demo)';
      discount = Math.round((subtotal * 10) / 100);
      // proportional allocation, rounding remainder to last line
      let allocated = 0;
      items.forEach((it, i) => {
        const share = i === items.length - 1 ? discount - allocated : Math.floor((it.line_subtotal * discount) / subtotal);
        allocated += share; it.discount_share = share; it.line_total = it.line_subtotal - share;
      });
    }
    const total = subtotal - discount;
    invoiceSeq++;
    const inv: Row = { id: invoiceId, tenant_id: T, branch_id: v.branch, patient_id: patients[v.plan.patient].id, appointment_id: v.apptId, invoice_number: 10000 + invoiceSeq,
      status, subtotal, discount_type: discountType, discount_value: discountValue, discount_amount: discount, discount_reason: discountReason,
      discount_approved_by_name: discount ? 'Dilnoza Karimova' : null, total, paid_amount: 0,
      void_reason: status === 'void' ? pick(['Bepul qayta ko‘rik — rahbar qarori', 'Xizmat ko‘rsatilmadi, hisob bekor qilindi']) : null,
      version: 1, created_at: created, updated_at: created };
    // payments
    const cashier = cashierFor(v.branch);
    const payBase = v.plan.status === 'completed' ? v.end : new Date((v.orders[0].ordered_at as Date).getTime() + 4 * 60_000);
    const pays: { amount: number; method: string; at: Date }[] = [];
    const roundSom = (tiyin: number) => Math.floor(tiyin / (10_000 * SO)) * 10_000 * SO;
    if (status === 'paid') {
      if (invoiceSeq % 9 === 4 && total > 100_000 * SO) {
        const first = roundSom(total * 0.6);
        pays.push({ amount: first, method: 'cash', at: new Date(payBase.getTime() + 6 * 60_000) });
        pays.push({ amount: total - first, method: 'card', at: new Date(payBase.getTime() + 7 * 60_000) });
      } else pays.push({ amount: total, method: pick(methods), at: new Date(payBase.getTime() + int(3, 25) * 60_000) });
    } else if (status === 'partially_paid') {
      let part = roundSom(total * (0.35 + rnd() * 0.3));
      if (v.plan.patient === 3 && v.plan.date === demoDate) part = 100_000 * SO; // Sherzod: 100 000 of 210 000
      if (part <= 0 || part >= total) part = Math.floor(total / 2);
      pays.push({ amount: part, method: pick(methods), at: new Date(payBase.getTime() + int(3, 25) * 60_000) });
    }
    for (const p of pays) {
      receiptSeq++;
      const payId = sid(`payment:${invoiceId}:${receiptSeq}`);
      data.payments.push({ id: payId, tenant_id: T, branch_id: v.branch, invoice_id: invoiceId, receipt_number: 50000 + receiptSeq, amount: p.amount, method: p.method,
        cashier_membership_id: cashier.id, cashier_name: cashier.name, paid_at: p.at, note: null, idempotency_key: `seed-${payId}`, request_hash: null });
      inv.paid_amount += p.amount;
      audit(p.at, v.branch, cashier.id, cashier.name, 'cashier', 'payment.create', 'invoice', invoiceId, `To‘lov qayd etildi: ${(p.amount / SO).toLocaleString('ru-RU')} so‘m`);
    }
    if (status === 'void') audit(new Date(created.getTime() + 3600_000), v.branch, M.manager, 'Dilnoza Karimova', 'manager', 'invoice.void', 'invoice', invoiceId, inv.void_reason);
    data.invoices.push(inv);
    data.invoice_items.push(...items);
    invoiceTimeline.push({ inv, v });
    for (const o of v.orders) data.service_orders.push(o);
  }
  data.tenants.push({ id: T, name: 'Med.uz.ai Demo Clinic', status: 'active', patient_seq: 1100, invoice_seq: 10000 + invoiceSeq, receipt_seq: 50000 + receiptSeq, shift_seq: 2, refund_seq: 0, created_at: createdBase, updated_at: createdBase });

  // patient creation audit (the 30 most recent)
  patients.slice(-30).forEach((p) => audit(p.created_at, BC, M.registrar, 'Malika Yusupova', 'registrar', 'patient.create', 'patient', p.id, `Bemor #${p.patient_number} yaratildi`));

  // ---------- consent (ZRU-547): ~70% of the cards have a signed paper form, the rest show the «Rozilik yo‘q» notice ----------
  // A deterministic rule, no RNG: the seeded numbers (KPIs) stay exactly as before.
  patients.filter((p) => p.patient_number % 10 < 7).forEach((p) => data.patient_consents.push({
    id: sid(`consent:${p.id}`), tenant_id: T, patient_id: p.id, kind: 'data_processing', granted: true, text_version: '2026-10', method: 'signed_paper',
    recorded_by: M.registrar, recorded_by_name: 'Malika Yusupova', recorded_at: p.created_at, note: null,
  }));

  // ---------- expenses (P1) ----------
  const EXP: [number, string, string, number, string][] = [
    [-28, BC, 'Ijara', 18_000_000, 'Oktabr oyi ijarasi'], [-28, BY, 'Ijara', 12_000_000, 'Oktabr oyi ijarasi'],
    [-25, BC, 'Reagentlar', 6_400_000, 'Laboratoriya reagentlari'], [-21, BC, 'Kommunal', 2_150_000, 'Elektr va suv'],
    [-21, BY, 'Kommunal', 1_380_000, 'Elektr va suv'], [-17, BC, 'Xo‘jalik', 740_000, 'Tozalash vositalari'],
    [-14, BY, 'Tibbiy sarf materiallari', 3_250_000, 'Shprits, qo‘lqop, bint'], [-11, BC, 'IT xizmatlari', 1_200_000, 'Internet va aloqa'],
    [-8, BC, 'Marketing', 2_500_000, 'Ijtimoiy tarmoq reklamasi'], [-6, BY, 'Xo‘jalik', 460_000, 'Ofis buyumlari'],
    [-3, BC, 'Reagentlar', 3_900_000, 'Biokimyo reagentlari'], [-1, BY, 'Ta’mirlash', 1_100_000, 'Konditsioner xizmati'],
  ];
  EXP.forEach(([d, b, c, a, n], i) => data.expenses.push({ id: sid(`expense:${i}`), tenant_id: T, branch_id: b, category: c, amount: a * SO, occurred_at: at(addDays(demoDate, d), hm('12:00')), note: n }));

  // ---------- inventory (P1): 20 items, 4 below minimum ----------
  const INV: [string, string, string, number, number, number[], number[]][] = [
    // name, unit, branch, opening, minimum, incomings, outgoings
    ['Bir martalik shprits 5 ml', 'dona', BC, 800, 200, [500], [300, 250, 280]],
    ['Tibbiy qo‘lqop (M)', 'juft', BC, 1000, 300, [], [350, 300, 160]], // low: 190
    ['Spirtli salfetka', 'dona', BC, 2000, 400, [1000], [600, 700]],
    ['Vakutayner (qizil qopqoq)', 'dona', BC, 600, 150, [], [200, 180, 140]], // low: 80
    ['Vakutayner (binafsha qopqoq)', 'dona', BC, 600, 150, [300], [220, 160]],
    ['UQT reagenti to‘plami', 'to‘plam', BC, 12, 4, [6], [5, 4]],
    ['Glyukoza test-polosalari', 'quti', BC, 30, 10, [], [9, 8, 6]], // low: 7
    ['Bioximiya kalibratori', 'flakon', BC, 10, 3, [4], [3, 2]],
    ['UZI geli 5 l', 'kanistr', BC, 8, 2, [2], [3, 2]],
    ['EKG lentasi', 'rulon', BC, 40, 10, [20], [15, 12]],
    ['Bint steril', 'dona', BY, 300, 80, [100], [90, 70]],
    ['Tibbiy niqob', 'dona', BY, 1500, 300, [], [500, 450, 400]], // low: 150
    ['Bir martalik choyshab', 'dona', BY, 400, 100, [200], [150, 120]],
    ['Termometr qoplamasi', 'dona', BY, 500, 100, [], [120, 100]],
    ['Antiseptik eritma 1 l', 'flakon', BY, 40, 10, [20], [15, 12]],
    ['Bir martalik shprits 2 ml', 'dona', BY, 600, 150, [300], [200, 180]],
    ['Tomchi tizimi', 'dona', BY, 200, 50, [100], [70, 60]],
    ['Paxta 100 g', 'o‘ram', BY, 100, 25, [50], [30, 25]],
    ['Siydik konteyneri', 'dona', BC, 300, 80, [150], [110, 90]],
    ['Ginekologik to‘plam', 'to‘plam', BY, 120, 30, [60], [40, 35]],
  ];
  let mv = 0;
  INV.forEach(([name, unit, b, open, min, ins, outs], i) => {
    const id = sid(`inv:${i}`);
    data.inventory_items.push({ id, tenant_id: T, branch_id: b, name, unit, opening_qty: open, minimum_qty: min });
    const moves = [...ins.map((q) => ({ type: 'in', q })), ...outs.map((q) => ({ type: 'out', q }))];
    moves.forEach((m, j) => {
      data.inventory_movements.push({ id: sid(`invmv:${i}:${j}`), tenant_id: T, item_id: id, type: m.type, quantity: m.q,
        reason: m.type === 'in' ? 'Yetkazib beruvchidan kirim' : 'Bo‘limga berildi', actor_name: m.type === 'in' ? 'Dilnoza Karimova' : 'Gulnora Saidova',
        occurred_at: at(addDays(demoDate, -26 + ((i * 3 + j * 7) % 25)), hm('10:00') + j * 30) });
      mv++;
    });
  });
  void mv; void k;

  // ---------- second tenant (isolation test) ----------
  const T2 = SEED_IDS.tenant2;
  data.tenants.push({ id: T2, name: 'Izolyatsiya Test Klinikasi', status: 'active', patient_seq: 3, invoice_seq: 0, receipt_seq: 0, shift_seq: 0, refund_seq: 0, created_at: createdBase, updated_at: createdBase });
  data.branches.push({ id: SEED_IDS.branchTenant2, tenant_id: T2, name: 'Test filiali', code: 'TST', address: 'Demo manzil', timezone: 'Asia/Tashkent', created_at: createdBase });
  addStaff('t2rahbar', M.tenant2Manager, 'Test Rahbar (2-tenant)', 'manager', [SEED_IDS.branchTenant2], 'Klinika rahbari', true, T2);
  [['Boshqa', 'Bemor', '1990-01-01'], ['Izolyatsiya', 'Sinov', '1975-06-15'], ['Ikkinchi', 'Tenant', '2001-09-09']].forEach(([l, f, b], i) =>
    data.patients.push({ id: sid(`t2patient:${i}`), tenant_id: T2, patient_number: 1 + i, last_name: l, first_name: f, middle_name: null, birth_date: b, sex: 'unspecified',
      phone: FAMILY_PHONE, contact_name: null, contact_phone: null, address: null, note: 'Ikkinchi tenant bemori', allergy_state: 'unknown', allergy_note: null, created_at: createdBase, updated_at: createdBase }));

  data.audit_logs.sort((a, b) => (a.occurred_at as Date).getTime() - (b.occurred_at as Date).getTime());
  // memberships must exist before doctors (FK): already true by insertion order in resetDemo.
  // ---------- cash shifts (today): both cashiers opened their drawer before the first payment ----------
  // No RNG is used here, so the seeded KPIs stay exactly as before.
  const shiftOpen = at(demoDate, hm('07:00'));
  const SHIFTS = [
    { id: sid('shift:central'), branch: BC, cashierId: M.cashier, name: 'Nodira Aliyeva', opening: 500_000 },
    { id: sid('shift:yunusobod'), branch: BY, cashierId: M.cashier2, name: 'Jasur Toshmatov', opening: 300_000 },
  ];
  SHIFTS.forEach((sh, i) => {
    data.cash_shifts.push({ id: sh.id, tenant_id: T, branch_id: sh.branch, cashier_membership_id: sh.cashierId, cashier_name: sh.name,
      number: i + 1, status: 'open', opened_at: shiftOpen, opening_cash: sh.opening * SO });
    audit(shiftOpen, sh.branch, sh.cashierId, sh.name, 'cashier', 'cash_shift.open', 'cash_shift', sh.id, `Smena №${i + 1} ochildi, kassada ${sh.opening.toLocaleString('ru-RU')} so‘m`);
  });
  const dayStart = at(demoDate, 0), dayEnd = at(addDays(demoDate, 1), 0);
  for (const pm of data.payments) {
    const sh = SHIFTS.find((x) => x.branch === pm.branch_id && x.cashierId === pm.cashier_membership_id);
    pm.shift_id = sh && pm.paid_at >= dayStart && pm.paid_at < dayEnd ? sh.id : null;
  }

  return data;
}
