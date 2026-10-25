/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The demo security guard (migration 038, docs/SECURITY_GUARD.md): three guards of the central branch (the day guard
 * «Bahodir Usmonov» is the demo card), three weeks of post shifts with handover notes, patrol rounds over seven
 * checkpoints, the handling of the seed's camera alerts (taken, resolved, one filed as an incident, one escalated),
 * an incident log, the visitor log and the key log of the doctors' rooms.
 *
 * Built AFTER the main seed from its rows, with its own PRNG (like the cameras' stream), so the main sequence — and
 * every seeded KPI of «today» — stays exactly as before. Ids are hashes of fixture keys: the same rows every time.
 * All people, organisations and texts are synthetic; no patient is named anywhere.
 */
import { addDays, DEMO_TIMEZONE_OFFSET_HOURS, SEED_IDS, sid, type SeedData } from './build';

type Row = Record<string, any>;
export interface GuardSeed {
  users: Row[]; memberships: Row[]; guard_shifts: Row[]; security_incidents: Row[]; security_incident_entries: Row[]; security_alert_actions: Row[];
  patrol_checkpoints: Row[]; patrol_rounds: Row[]; patrol_marks: Row[]; security_visitors: Row[]; key_events: Row[]; staff_presence_marks: Row[];
  security_counters: Row[];
}
/** Insert order (foreign keys). */
export const GUARD_TABLES: (keyof GuardSeed)[] = ['users', 'memberships', 'guard_shifts', 'security_incidents', 'security_incident_entries', 'security_alert_actions',
  'patrol_checkpoints', 'patrol_rounds', 'patrol_marks', 'security_visitors', 'key_events', 'staff_presence_marks', 'security_counters'];

export const GUARD_IDS = { bahodir: sid('membership:guard'), dilshod: sid('membership:guard2'), anvar: sid('membership:guard3') };

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function at(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - DEMO_TIMEZONE_OFFSET_HOURS * 3600_000);
}
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const localDay = (d: Date) => new Date(d.getTime() + DEMO_TIMEZONE_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
const localMin = (d: Date) => { const l = new Date(d.getTime() + DEMO_TIMEZONE_OFFSET_HOURS * 3600_000); return l.getUTCHours() * 60 + l.getUTCMinutes(); };
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

const HISTORY_DAYS = 21;
const HANDOVER = [
  'Hammasi joyida. Orqa eshik qulflangan, kalitlar to‘liq.',
  'Avtoturargohdagi chiroq yonmayapti — elektrikka aytildi.',
  'Kassa xonasi signalizatsiyasi tekshirildi, ishlayapti.',
  'Kechasi ombor kamerasi bir marta ogohlantirdi — tekshirildi, hech kim yo‘q.',
  'Orqa eshik qulfi qiyin yopiladi, ehtiyot bo‘ling.',
  'Yetkazib beruvchi ertalab 9 da keladi, omborchi kutadi.',
  'Tinch o‘tdi. Obxodlar o‘z vaqtida.',
  'Operatsiya bloki eshigi yopiq, kalit rahbarda.',
];
const ALERT_NOTES: Record<string, string[]> = {
  false_alarm: ['Mushuk o‘tdi', 'Shamol pardani qimirlatdi', 'Farrosh xona tozalayotgan ekan', 'Mashina chirog‘i tushdi', 'Hech kim yo‘q, eshik yopiq'],
  checked_ok: ['Joyida tekshirildi, hammasi tartibda', 'Navbatchi hamshira ekan', 'Eshik qulflandi', 'Xodim kech qolgan ekan, ketdi'],
};
const PROBLEMS = ['Deraza ochiq qolgan edi, yopildi', 'Chiroq yonmayapti', 'Eshik qulflanmagan edi, qulflandi', 'Yo‘lakda quti qoldirilgan, olib qo‘yildi'];
const VISITOR_NAMES = ['Javohir Tursunov', 'Oybek Saidov', 'Nodir Hamidov', 'Sherali Qosimov', 'Ulug‘bek Ahmedov', 'Farrux Yo‘ldoshev', 'Kamol Nurmatov', 'Rustam Aliyev',
  'Botir Xudoyberdiyev', 'Elyor Murodov', 'Zafar Ismoilov', 'Sardor Valiyev', 'Gulshan Rahimova', 'Madina To‘xtayeva', 'Dildora Yusupova', 'Akbar Sobirov'];
const VISITS: { purpose: string; orgs: (string | null)[]; host: 'keeper' | 'manager' | 'lab' | null; note: string | null; min: [number, number] }[] = [
  { purpose: 'delivery', orgs: ['Express24 kuryer', 'Uzum Market kuryer', 'Yandex Yetkazib berish'], host: null, note: 'Hujjatlar paketi', min: [5, 15] },
  { purpose: 'supplier', orgs: ['Toshkent dori ta’minot', 'Medtexnika servis', 'Asia Pharm distribyutor'], host: 'keeper', note: 'Dori yetkazib berish, nakladnaya bilan', min: [20, 50] },
  { purpose: 'supplier', orgs: ['Lab reagent servis'], host: 'lab', note: 'Reagentlar', min: [15, 40] },
  { purpose: 'repair', orgs: ['Lift servis', 'Elektr ta’mirlash', 'Konditsioner ustasi'], host: 'manager', note: 'Rejali ta’mirlash', min: [40, 120] },
  { purpose: 'inspection', orgs: ['Yong‘in xavfsizligi inspeksiyasi', 'Sanitariya-epidemiologiya xizmati'], host: 'manager', note: 'Rejali tekshiruv', min: [45, 110] },
  { purpose: 'meeting', orgs: ['Sug‘urta kompaniyasi', null], host: 'manager', note: null, min: [30, 70] },
  { purpose: 'interview', orgs: [null], host: 'manager', note: 'Hamshira lavozimiga', min: [25, 50] },
];

/** The guard's demo data on top of the main seed's rows (`data`). */
export function buildGuard(data: SeedData, demoDate: string, demoTime?: string): GuardSeed {
  const rnd = mulberry32(20261038);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const T = SEED_IDS.tenant, BC = SEED_IDS.branchCentral, BY = SEED_IDS.branchYunusobod, M = SEED_IDS.membership;
  const demoNowMin = demoTime && /^\d{2}:\d{2}$/.test(demoTime) ? hm(demoTime)
    : (() => { const l = new Date(Date.now() + DEMO_TIMEZONE_OFFSET_HOURS * 3600_000); return l.getUTCHours() * 60 + l.getUTCMinutes(); })();
  const NOW = at(demoDate, demoNowMin);
  const past = (d: Date) => d.getTime() <= NOW.getTime();
  const createdBase = at(addDays(demoDate, -90), hm('09:00'));
  const g: GuardSeed = { users: [], memberships: [], guard_shifts: [], security_incidents: [], security_incident_entries: [], security_alert_actions: [],
    patrol_checkpoints: [], patrol_rounds: [], patrol_marks: [], security_visitors: [], key_events: [], staff_presence_marks: [], security_counters: [] };

  // ---- the guards (central branch); the day guard is the demo card
  const GUARDS = [
    { key: 'qorovul1', id: GUARD_IDS.bahodir, name: 'Bahodir Usmonov', title: 'Qorovul (kunduzgi smena)', card: true },
    { key: 'qorovul2', id: GUARD_IDS.dilshod, name: 'Dilshod Rahmonov', title: 'Qorovul (kunduzgi smena)', card: false },
    { key: 'qorovul3', id: GUARD_IDS.anvar, name: 'Anvar Karimov', title: 'Qorovul (tungi smena)', card: false },
  ];
  for (const x of GUARDS) {
    const uid = sid('user:' + x.key);
    g.users.push({ id: uid, email: `${x.key}@meduza-demo.example.test`, full_name: x.name, created_at: createdBase });
    g.memberships.push({ id: x.id, tenant_id: T, user_id: uid, role: 'guard', branch_ids: [BC], title: x.title, status: 'active', demo_card: x.card, created_at: createdBase });
  }
  const nameOf = (id: string) => GUARDS.find((x) => x.id === id)!.name;
  const userName = (mid: string) => { const m = data.memberships.find((x) => x.id === mid); return data.users.find((u) => u.id === m?.user_id)?.full_name as string; };
  const MANAGER = { id: M.manager, name: userName(M.manager) };

  // ---- post shifts: a day shift (alternating day guards) and a night shift (Anvar) every day
  type Shift = Row & { kind: 'day' | 'night'; date: string };
  const shifts: Shift[] = [];
  for (let back = HISTORY_DAYS; back >= 0; back--) {
    const date = addDays(demoDate, -back);
    for (const kind of ['day', 'night'] as const) {
      const guard = kind === 'night' ? GUARD_IDS.anvar : back % 2 === 0 ? GUARD_IDS.bahodir : GUARD_IDS.dilshod;
      const opened = kind === 'day' ? at(date, hm('07:55') + int(0, 5)) : at(date, hm('19:52') + int(0, 6));
      const closed = kind === 'day' ? at(date, hm('20:02') + int(0, 6)) : at(addDays(date, 1), hm('08:00') + int(1, 6));
      if (!past(opened)) continue;
      shifts.push({ id: sid(`g:shift:${date}:${kind}`), kind, date, tenant_id: T, branch_id: BC, number: 0, guard_membership_id: guard, guard_name: nameOf(guard),
        opened_at: opened, closed_at: past(closed) ? closed : null, closed_by: past(closed) ? guard : null, handover_note: past(closed) ? pick(HANDOVER) : null });
    }
  }
  shifts.sort((a, b) => a.opened_at.getTime() - b.opened_at.getTime()).forEach((s, i) => { s.number = i + 1; });
  /** The shift on duty at an instant (day 08:00–20:00, else the night that started the evening before). */
  const shiftAt = (d: Date) => {
    const min = localMin(d), day = localDay(d);
    const k = min >= hm('08:00') && min < hm('20:00') ? `${day}:day` : `${min >= hm('20:00') ? day : addDays(day, -1)}:night`;
    return shifts.find((s) => s.id === sid(`g:shift:${k}`));
  };
  for (const s of shifts) { const { kind: _k, date: _d, ...row } = s; g.guard_shifts.push(row); }

  // ---- incidents (static list; the texts never name a patient)
  let incidentNo = 0;
  const incident = (key: string, v: { when: Date; category: string; severity: string; description: string; place?: string | null; room?: string | null;
    source?: string; sosReason?: string | null; alertEventId?: string | null; by: { id: string; name: string; role: string } }) => {
    if (!past(v.when)) return null;
    const sh = v.by.role === 'guard' ? shiftAt(v.when) : undefined;
    const row = { id: sid('g:incident:' + key), tenant_id: T, branch_id: BC, number: ++incidentNo, category: v.category, severity: v.severity,
      room_id: v.room ? sid('room:' + v.room) : null, place: v.place ?? null, description: v.description, source: v.source ?? 'manual', sos_reason: v.sosReason ?? null,
      alert_event_id: v.alertEventId ?? null, shift_id: sh && sh.guard_membership_id === v.by.id ? sh.id : null,
      reported_by: v.by.id, reported_by_name: v.by.name, reported_by_role: v.by.role, reported_at: v.when };
    g.security_incidents.push(row);
    return row;
  };
  const entry = (inc: Row | null, key: string, kind: string, when: Date, text: string | null, by: { id: string; name: string; role: string }) => {
    if (!inc || !past(when)) return;
    g.security_incident_entries.push({ id: sid(`g:entry:${key}`), tenant_id: T, incident_id: inc.id, kind, text, author_membership_id: by.id, author_name: by.name, author_role: by.role, created_at: when });
  };
  const onDuty = (d: Date) => { const s = shiftAt(d); return s ? { id: s.guard_membership_id as string, name: s.guard_name as string, role: 'guard' } : { ...MANAGER, role: 'manager' }; };
  const mgr = { ...MANAGER, role: 'manager' };
  const day = (back: number, time: string) => at(addDays(demoDate, -back), hm(time));

  // ---- alert handling: the guard on duty takes and closes the seed's central-branch alerts
  const alerts = data.camera_events.filter((e) => e.alert && e.branch_id === BC).sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime());
  const acked = new Set(data.camera_event_acks.map((a) => a.event_id));
  const ackAt = new Map(data.camera_event_acks.map((a) => [a.event_id, a.acked_at as Date]));
  const linkedIncident = new Map<string, Row>();
  for (const e of alerts) {
    if (!acked.has(e.id)) continue; // the seed's open alerts stay new for the guard
    const sh = shiftAt(e.occurred_at);
    if (!sh) continue; // before the first seeded shift: the manager acknowledged it in the morning
    const by = { id: sh.guard_membership_id as string, name: sh.guard_name as string };
    const take = plus(e.occurred_at, int(1, 7));
    const done = plus(take, int(3, 16));
    const key = String(e.dedupe_key);
    let outcome: string, note: string | null = null, incidentId: string | null = null;
    if (key.includes('mrk-store:10:00:40')) {
      outcome = 'incident';
      const inc = incident('store-loitering', { when: plus(take, 6), category: 'suspicious', severity: 'high', place: 'Dori ombori eshigi', source: 'alert', alertEventId: e.id,
        description: 'Ombor eshigi oldida sumkali noma’lum odam turdi. Yondashganda ketdi, eshik qulfi butun.', by: { ...by, role: 'guard' } });
      entry(inc, 'store-loitering:close', 'close', day(9, '10:10'), 'Ombor eshigiga qo‘shimcha qulf o‘rnatildi, tungi obxodga ombor nuqtasi qo‘shildi.', mgr);
      incidentId = inc?.id ?? null;
      if (inc) linkedIncident.set(e.id, inc);
    } else if (key.includes('mrk-or:14:23:58')) {
      outcome = 'escalated'; note = 'Favqulodda chiqish eshigi ochilgan, kim chiqqani ko‘rinmadi';
    } else if (e.kind === 'tamper') {
      outcome = 'checked_ok'; note = 'Kamera oldiga quti qo‘yilgan ekan, olib tashlandi';
    } else {
      outcome = rnd() < 0.6 ? 'false_alarm' : 'checked_ok'; note = rnd() < 0.7 ? pick(ALERT_NOTES[outcome]) : null;
    }
    if (!past(done)) continue;
    g.security_alert_actions.push({ id: sid(`g:act:${e.id}:1`), tenant_id: T, event_id: e.id, branch_id: BC, seq: 1, action: 'take', outcome: null, note: null, incident_id: null,
      actor_membership_id: by.id, actor_name: by.name, actor_role: 'guard', acted_at: take });
    g.security_alert_actions.push({ id: sid(`g:act:${e.id}:2`), tenant_id: T, event_id: e.id, branch_id: BC, seq: 2, action: 'resolve', outcome, note, incident_id: incidentId,
      actor_membership_id: by.id, actor_name: by.name, actor_role: 'guard', acted_at: done });
    if (outcome === 'escalated') {
      const m = ackAt.get(e.id)!;
      g.security_alert_actions.push({ id: sid(`g:act:${e.id}:3`), tenant_id: T, event_id: e.id, branch_id: BC, seq: 3, action: 'resolve', outcome: 'checked_ok',
        note: 'Signalizatsiya tekshirildi, eshik yopib qo‘yildi', incident_id: null, actor_membership_id: MANAGER.id, actor_name: MANAGER.name, actor_role: 'manager', acted_at: m });
    }
  }

  // ---- the incident log
  const i1 = incident('queue', { when: day(19, '10:20'), category: 'conflict', severity: 'medium', place: 'Qabulxona', by: onDuty(day(19, '10:20')),
    description: 'Navbat sababli ikki kishi o‘rtasida tortishuv bo‘ldi. Tinchlantirildi, registrator navbat tartibini tushuntirdi.' });
  entry(i1, 'queue:close', 'close', day(18, '09:30'), 'Navbat tablosi kutish zalidagi ikkinchi ekranga ham chiqarildi.', mgr);
  const i2 = incident('barrier', { when: day(16, '15:10'), category: 'damage', severity: 'low', place: 'Avtoturargoh', by: onDuty(day(16, '15:10')),
    description: 'Yetkazib beruvchi mashinasi shlagbaumga tegdi. Shlagbaum ishlayapti, tashkilotga xabar berildi.' });
  entry(i2, 'barrier:close', 'close', day(15, '11:00'), 'Tashkilot zararni qoplashga rozi bo‘ldi.', mgr);
  const i3 = incident('backdoor', { when: day(13, '21:40'), category: 'suspicious', severity: 'medium', place: 'Orqa eshik', by: onDuty(day(13, '21:40')),
    description: 'Orqa eshik oldida noma’lum odam uzoq turdi, so‘ralganda ketdi.' });
  entry(i3, 'backdoor:note', 'note', day(13, '22:05'), 'Obxodda qayta tekshirildi, hech kim yo‘q.', onDuty(day(13, '22:05')));
  entry(i3, 'backdoor:close', 'close', day(12, '09:15'), 'Orqa eshik tepasiga chiroq o‘rnatish rejalashtirildi.', mgr);
  const i5 = incident('faint', { when: day(8, '11:05'), category: 'medical', severity: 'high', place: 'Asosiy kirish', by: onDuty(day(8, '11:05')),
    description: 'Kirishda keksa ayolning boshi aylandi. Navbatchi shifokor chaqirildi, tez yordam kerak bo‘lmadi.' });
  entry(i5, 'faint:close', 'close', day(8, '13:00'), 'Kirishga stul va suv qo‘yildi.', mgr);
  const i6 = incident('charger', { when: day(6, '14:30'), category: 'theft', severity: 'medium', place: 'Kutish zali', by: onDuty(day(6, '14:30')),
    description: 'Kutish zalidagi umumiy telefon quvvatlagichi yo‘qoldi. Kamera yozuvi rahbarga topshirildi.' });
  entry(i6, 'charger:correction', 'correction', day(6, '15:00'), 'Quvvatlagich emas — uzaytirgich (udlinitel) yo‘qolgan.', onDuty(day(6, '15:00')));
  entry(i6, 'charger:close', 'close', day(5, '10:00'), 'Uzaytirgich topildi: farrosh xonasiga olib qo‘yilgan ekan.', mgr);
  const i7 = incident('panel', { when: day(4, '19:15'), category: 'fire', severity: 'high', place: 'Yerto‘la, elektr shiti', by: onDuty(day(4, '19:15')),
    description: 'Elektr shitidan kuyish hidi keldi. Rubilnik o‘chirildi, elektrik chaqirildi, avtomat almashtirildi.' });
  entry(i7, 'panel:close', 'close', day(3, '09:40'), 'Elektr tarmog‘i to‘liq tekshirildi, dalolatnoma olindi.', mgr);
  const i8 = incident('sos', { when: day(3, '12:40'), category: 'conflict', severity: 'critical', place: 'Qabulxona', source: 'sos', sosReason: 'aggression', by: onDuty(day(3, '12:40')),
    description: 'Tajovuz / janjal. Bir kishi baqirib registratorga tahdid qildi.' });
  entry(i8, 'sos:seen', 'seen', day(3, '12:42'), null, mgr);
  entry(i8, 'sos:note', 'note', day(3, '12:55'), 'Rahbar keldi, kishi tinchlandi va ketdi.', onDuty(day(3, '12:55')));
  entry(i8, 'sos:close', 'close', day(3, '16:00'), 'Suhbat o‘tkazildi, voqea yozildi. Politsiya chaqirilmadi.', mgr);
  const i9 = incident('handle', { when: day(2, '16:20'), category: 'damage', severity: 'medium', room: 'r103', by: onDuty(day(2, '16:20')),
    description: '103-xona eshigi tutqichi sindi.' });
  entry(i9, 'handle:correction', 'correction', day(2, '16:35'), 'Tutqich emas — qulf mexanizmi ishlamayapti, eshik yopilmaydi.', onDuty(day(2, '16:35')));
  incident('lamp', { when: day(1, '22:30'), category: 'other', severity: 'low', place: 'Avtoturargoh', by: onDuty(day(1, '22:30')),
    description: 'Avtoturargohda kechasi chiroq yonmayapti, burchak qorong‘i.' });
  incident('courier', { when: day(0, '09:15'), category: 'suspicious', severity: 'low', place: 'Asosiy kirish', by: onDuty(day(0, '09:15')),
    description: 'Kuryer xodimlar zonasiga kirmoqchi bo‘ldi, qabulxonada kutishi so‘raldi.' });

  // ---- patrol: seven checkpoints of the central branch (three in Yunusobod, no guard there yet)
  const POINTS = ['Asosiy kirish', 'Orqa eshik (favqulodda chiqish)', 'Dori ombori eshigi', 'Kassa xonasi', 'Operatsiya bloki, 2-qavat', 'Avtoturargoh', 'Yerto‘la, elektr shiti'];
  POINTS.forEach((name, i) => g.patrol_checkpoints.push({ id: sid(`g:point:mrk:${i}`), tenant_id: T, branch_id: BC, name, position: i + 1, active: true, created_at: createdBase }));
  ['Kirish', 'Kassa', 'Orqa hovli'].forEach((name, i) => g.patrol_checkpoints.push({ id: sid(`g:point:yun:${i}`), tenant_id: T, branch_id: BY, name, position: i + 1, active: true, created_at: createdBase }));
  const points = g.patrol_checkpoints.filter((p) => p.branch_id === BC);
  for (const s of shifts) {
    const slots = s.kind === 'day' ? ['09:00', '12:00', '15:00', '18:00'] : ['22:00', '01:00', '04:00', '07:00'];
    for (const slot of slots) {
      const date = s.kind === 'night' && hm(slot) < hm('12:00') ? addDays(s.date, 1) : s.date;
      const start = at(date, hm(slot) + int(-5, 12));
      if (rnd() < 0.07) continue; // a missed round: the manager's compliance shows it
      const skip = rnd() < 0.05 ? int(1, points.length - 1) : -1;
      let t = start;
      const marks: Row[] = [];
      const rid = sid(`g:round:${s.id}:${slot}`);
      points.forEach((p, i) => {
        t = plus(t, int(2, 5));
        if (i === skip) return;
        const problem = rnd() < 0.02;
        marks.push({ id: sid(`g:mark:${rid}:${i}`), tenant_id: T, round_id: rid, checkpoint_id: p.id, result: problem ? 'problem' : 'ok', note: problem ? pick(PROBLEMS) : null, incident_id: null, marked_at: t });
      });
      const finished = plus(t, int(1, 3));
      if (!past(finished)) continue; // never an unfinished seeded round
      g.patrol_rounds.push({ id: rid, tenant_id: T, branch_id: BC, shift_id: s.id, guard_membership_id: s.guard_membership_id, guard_name: s.guard_name,
        checkpoints_total: points.length, started_at: start, finished_at: finished });
      g.patrol_marks.push(...marks);
    }
  }
  // one patrol finding was filed as an incident
  const nightRound = g.patrol_rounds.find((r) => localDay(r.started_at) === addDays(demoDate, -5) && localMin(r.started_at) < hm('03:00'));
  if (nightRound) {
    const m = g.patrol_marks.find((x) => x.round_id === nightRound.id && x.checkpoint_id === points[1].id);
    if (m) {
      const inc = incident('patrol-door', { when: m.marked_at, category: 'other', severity: 'medium', place: points[1].name, source: 'patrol',
        description: 'Favqulodda chiqish eshigi qulflanmagan edi, qulflandi.', by: { id: nightRound.guard_membership_id, name: nightRound.guard_name, role: 'guard' } });
      if (inc) {
        Object.assign(m, { result: 'problem', note: 'Favqulodda chiqish eshigi qulflanmagan edi, qulflandi.', incident_id: inc.id });
        entry(inc, 'patrol-door:close', 'close', day(4, '09:00'), 'Kechki xodimlarga eshikni tekshirish eslatildi.', mgr);
      }
    }
  }

  // ---- visitors (non-patients): couriers, suppliers, repair, inspectors …
  const hostOf = (h: string | null) => h === 'keeper' ? { id: M.storekeeper, name: userName(M.storekeeper) } : h === 'lab' ? { id: M.lab, name: userName(M.lab) }
    : h === 'manager' ? MANAGER : null;
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const date = addDays(demoDate, -back);
    const wd = new Date(date + 'T00:00:00Z').getUTCDay();
    const n = wd === 0 ? int(0, 1) : int(2, 5);
    for (let k = 0; k < n; k++) {
      const v = pick(VISITS);
      let inAt = at(date, int(hm('08:40'), hm('17:00')));
      let outAt: Date | null = plus(inAt, int(v.min[0], v.min[1]));
      if (back === 0) {
        // today: two visitors are still inside at the demo time, the others came and went
        if (k < 2) { inAt = at(date, Math.max(hm('08:30'), demoNowMin - (k === 0 ? 38 : 14))); outAt = null; }
        else { inAt = at(date, Math.max(hm('08:20'), demoNowMin - int(70, 180))); outAt = plus(inAt, int(5, 25)); if (!past(outAt)) outAt = null; }
      }
      if (!past(inAt)) continue;
      const host = hostOf(v.host);
      const by = onDuty(inAt);
      g.security_visitors.push({ id: sid(`g:visitor:${date}:${k}`), tenant_id: T, branch_id: BC, full_name: pick(VISITOR_NAMES), organisation: pick(v.orgs), purpose: v.purpose,
        purpose_note: v.note, host_membership_id: host?.id ?? null, host_name: host?.name ?? null, pass_no: v.purpose === 'delivery' ? null : `M-${String(int(1, 20)).padStart(2, '0')}`,
        in_at: inAt, out_at: outAt, recorded_by: by.id, recorded_by_name: by.name, out_by: outAt ? onDuty(outAt).id : null, purged_at: null });
    }
  }

  // ---- keys of the doctors' rooms in the central branch: taken before the first patient, back after the last
  const ROOM_DOCTOR: [string, number][] = [['r101', 0], ['r102', 1], ['r103', 2], ['r104', 6], ['r105', 7]];
  const keyEvent = (key: string, room: string, action: 'out' | 'in', when: Date, holder: { id: string; name: string }, note: string | null = null) => {
    if (!past(when)) return false;
    const by = onDuty(when);
    g.key_events.push({ id: sid('g:key:' + key), tenant_id: T, branch_id: BC, room_id: sid('room:' + room), action, holder_membership_id: holder.id, holder_name: holder.name,
      note, by_membership_id: by.id, by_name: by.name, at: when });
    return true;
  };
  const schedOn = (doc: number, date: string) => data.schedules.find((s) => s.doctor_id === SEED_IDS.doctor(doc) && s.weekday === new Date(date + 'T00:00:00Z').getUTCDay() && s.branch_id === BC);
  // one key taken yesterday never came back (overdue today): the first room whose doctor worked here yesterday
  const overdueRoom = ROOM_DOCTOR.find(([, doc]) => schedOn(doc, addDays(demoDate, -1)))?.[0];
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const date = addDays(demoDate, -back);
    for (const [room, doc] of ROOM_DOCTOR) {
      const sch = schedOn(doc, date);
      if (!sch) continue;
      const holder = { id: M.doctor(doc), name: userName(M.doctor(doc)) };
      if (room === overdueRoom && back === 0) continue; // still out since yesterday
      const out = at(date, hm(String(sch.start_time).slice(0, 5)) - int(3, 14));
      if (!keyEvent(`${date}:${room}:out`, room, 'out', out, holder)) continue;
      if (room === overdueRoom && back === 1) continue;
      // a week ago the lab key was handed back only the next morning (returned late)
      const back105 = room === 'r105' && back === 7;
      const inAt = back105 ? at(addDays(date, 1), hm('07:40')) : at(date, hm(String(sch.end_time).slice(0, 5)) + int(3, 22));
      keyEvent(`${date}:${room}:in`, room, 'in', inAt, holder, back105 ? 'Ertasi kuni ertalab qaytarildi' : null);
    }
  }

  // ---- a manual «came» mark: the storekeeper has no camera code
  const keeperIn = at(demoDate, hm('08:40'));
  if (past(keeperIn) && shiftAt(keeperIn)) {
    const by = onDuty(keeperIn);
    g.staff_presence_marks.push({ id: sid('g:presence:keeper'), tenant_id: T, branch_id: BC, membership_id: M.storekeeper, kind: 'in', by_membership_id: by.id, by_name: by.name, at: keeperIn });
  }

  // incident numbers follow time (the alert-linked one was created while walking the alerts)
  g.security_incidents.sort((a, b) => a.reported_at.getTime() - b.reported_at.getTime()).forEach((r, i) => { r.number = i + 1; });
  g.security_counters.push({ tenant_id: T, kind: 'incident', last: incidentNo }, { tenant_id: T, kind: 'shift', last: shifts.length });
  return g;
}
