/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The demo's longer story, built after the main seed with its own PRNG stream (the seeded KPIs of «today» do not move):
 * - four patients followed for months (diabetes, hyperlipidaemia, iron-deficiency anaemia, hypothyroidism) and an
 *   earlier check-up of Aziz Karimov — verified results over time, so «Natija sharhi» shows real trends;
 * - issued visit documents (prescriptions, referrals, certificates, one voided and re-issued), approved patient
 *   summaries, addenda to signed notes, structured allergies (doctor-confirmed and patient-reported), patient deposits,
 *   debt promises, one refund, schedule exceptions (vacation, day off, short day, public holidays) and notification consents.
 * Every row is written as the API would have left it (append-only tables are inserted in their final state).
 */
import { addDays, DEMO_TIMEZONE_OFFSET_HOURS, SEED_IDS, sid, type SeedData } from './build';
import { icdSnap, labValues, profilesOf, type NoteTpl } from './clinical';

type Row = Record<string, any>;
const SO = 100;
function at(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - DEMO_TIMEZONE_OFFSET_HOURS * 3600_000);
}
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const localDay = (d: Date) => new Date(d.getTime() + DEMO_TIMEZONE_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
const localTime = (d: Date) => new Date(d.getTime() + DEMO_TIMEZONE_OFFSET_HOURS * 3600_000).toISOString().slice(11, 16);
const weekdayOf = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();
const dmy = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

export interface HistoryCtx {
  demoDate: string; demoTime?: string;
  rnd: () => number;
  docs: { name: string; spec: string; share: number }[];
  svc: Record<string, Row>;
  schedOf: Record<string, Row>;
  priceAt: (code: string, when: Date) => number;
  adultsActive: number[];
  ageOf: (i: number) => number;
  visits: { plan: { doc: number; patient: number; date: string; start: number; svc: string; status: string; fixedKey?: string }; apptId: string; branch: string; start: Date; end: Date; encounterId?: string; orders: Row[] }[];
  lolaLeave: [number, number];
  plannedCritical?: { encounterId: string; text: string };
}

export function buildHistory(data: SeedData, x: HistoryCtx) {
  const T = SEED_IDS.tenant, BC = SEED_IDS.branchCentral, BY = SEED_IDS.branchYunusobod, M = SEED_IDS.membership;
  const { demoDate, rnd, docs, svc, schedOf, priceAt } = x;
  const pick = <V>(a: readonly V[]): V => a[Math.floor(rnd() * a.length)];
  const day = (back: number, min: number) => at(addDays(demoDate, -back), min);
  const demoNowMin = x.demoTime && /^\d{2}:\d{2}$/.test(x.demoTime) ? hm(x.demoTime) : 11 * 60 + 30;
  const patients = data.patients;
  const LAB = { id: M.lab, name: 'Gulnora Saidova' };
  const MANAGER = { id: M.manager, name: 'Dilnoza Karimova' };
  const cashierFor = (b: string) => (b === BC ? { id: M.cashier, name: 'Nodira Aliyeva' } : { id: M.cashier2, name: 'Jasur Toshmatov' });
  const registrarFor = (b: string) => (b === BC ? { id: M.registrar, name: 'Malika Yusupova' } : { id: M.registrar2, name: 'Shahzod Rahimov' });
  const branchName = (b: string) => (b === BC ? 'Markaziy filial' : 'Yunusobod filiali');
  const audit = (when: Date, branch: string | null, actor: { id: string | null; name: string }, role: string, action: string, type: string, id: string, summary: string) =>
    data.audit_logs.push({ tenant_id: T, branch_id: branch, actor_membership_id: actor.id, actor_name: actor.name, actor_role: role, action, resource_type: type, resource_id: id, summary, request_id: 'seed', occurred_at: when });
  const noteOf = (encId: string) => data.clinical_notes.find((n) => n.encounter_id === encId)!;
  const sharePct = (performer: number, code: string) => (docs[performer].share > 0 ? docs[performer].share : svc[code].share_percent);

  // ---------- the patients followed over months ----------
  const used = new Set<number>();
  const choose = (f: (i: number) => boolean) => { const i = x.adultsActive.find((k) => !used.has(k) && f(k)); if (i === undefined) throw new Error('seed history: no patient fits'); used.add(i); return i; };
  const female = (i: number) => patients[i].sex === 'female';
  const H1 = choose((i) => x.ageOf(i) >= 50 && x.ageOf(i) <= 68);                // type 2 diabetes
  const H2 = choose((i) => female(i) && x.ageOf(i) >= 52 && x.ageOf(i) <= 70);    // hypercholesterolaemia + hypertension
  const H3 = choose((i) => female(i) && x.ageOf(i) >= 24 && x.ageOf(i) <= 44);    // iron-deficiency anaemia
  const H4 = choose((i) => female(i) && x.ageOf(i) >= 30 && x.ageOf(i) <= 56);    // hypothyroidism
  const AZIZ = 0;
  // their cards were opened before the first of these visits (a card is never younger than its visits)
  const cardFrom: Record<number, number> = { [AZIZ]: 420, [H1]: 200, [H2]: 190, [H3]: 160, [H4]: 175 };
  for (const [i, back] of Object.entries(cardFrom)) {
    const p = patients[Number(i)];
    p.created_at = p.updated_at = day(back, hm('10:00') + Number(i) * 7);
    for (const c of data.patient_consents) if (c.patient_id === p.id && c.kind === 'data_processing') c.recorded_at = p.created_at;
    for (const a of data.audit_logs) if (a.resource_id === p.id && a.action === 'patient.create') a.occurred_at = p.created_at;
  }

  type Spec = { key: string; patient: number; doc: number; back: number; time: string; svc: string; extra?: string[]; labs: [string, Record<string, number>][];
    note: NoteTpl & { follow?: number }; vitals?: Record<string, number>; pay?: 'paid' | 'partial' };
  const tpl = (n: NoteTpl & { follow?: number }) => n;
  const SPECS: Spec[] = [
    // ---- Aziz Karimov: a check-up 3 months before his recent visits (high cholesterol found)
    { key: 'aziz0', patient: AZIZ, doc: 0, back: 95, time: '11:00', svc: 'C01', labs: [['L01', {}], ['L05', { LDL: 4.21, HDL: 1.08, TG: 2.05 }]], vitals: { bp_sys: 138, bp_dia: 88, pulse: 76, temp: 36.6 },
      note: tpl({ c: 'Ish joyi uchun yillik ko‘rik. Vaqti-vaqti bilan bosh og‘rig‘i.', a: 'Chekmaydi. Otasida gipertoniya. Penitsillinga allergiya (toshma).', e: 'Umumiy ahvoli qoniqarli. Yurak tonlari aniq, ritmik. AQB chegaraviy.',
        d: 'Umumiy tibbiy ko‘rik. Giperxolesterinemiya', icd: ['Z00.0', 'E78.0'], r: 'Parhez: hayvon yog‘larini cheklash, haftasiga 150 daqiqa yurish. AQBni uyda nazorat qilish. 3 oydan keyin qayta ko‘rik.' }) },
    // ---- H1: type 2 diabetes, HbA1c 9.4 → 8.1 → 7.3
    { key: 'h1a', patient: H1, doc: 5, back: 165, time: '10:00', svc: 'C08', labs: [['L03', { GLU: 10.8 }], ['L04', { HBA1C: 9.4 }]], vitals: { bp_sys: 136, bp_dia: 86, pulse: 82, temp: 36.6 },
      note: tpl({ c: 'Chanqash, tez-tez siyish, og‘izda quruqlik, 2 oyda 3 kg ozgan.', a: 'Onasida 2-tip qandli diabet. Kam harakat, shirinlikni ko‘p iste’mol qiladi.', e: 'Tana vazni indeksi 31 kg/m². Oyoq panjalarida sezuvchanlik saqlangan, pulsatsiya bor.',
        d: 'Qandli diabet, 2-tip, birinchi aniqlangan', icd: ['E11.9'], r: 'Metformin 500 mg kechki ovqat bilan, 2 haftadan keyin 1000 mg kuniga 2 marta. Parhez: tez so‘riladigan uglevodlarni cheklash, kuniga 30 daqiqa yurish. 2 oydan keyin HbA1c.', follow: 55 }) },
    { key: 'h1b', patient: H1, doc: 5, back: 110, time: '09:30', svc: 'C08', labs: [['L03', { GLU: 8.4 }], ['L04', { HBA1C: 8.1 }], ['L02', {}]], vitals: { bp_sys: 132, bp_dia: 84, pulse: 78, temp: 36.5 },
      note: tpl({ c: 'Chanqash kamaygan, ahvoli yaxshilangan.', a: 'Metformin 1000 mg kuniga 2 marta muntazam ichmoqda, 2 kg ozgan.', e: 'TVI 30 kg/m². Oyoqlarda o‘zgarish yo‘q.',
        d: 'Qandli diabet, 2-tip, subkompensatsiya', icd: ['E11.9'], r: 'Metforminni davom ettirish. Parhez va jismoniy faollik. 7 haftadan keyin glyukoza, HbA1c va lipid profil.', follow: 50 }) },
    { key: 'h1c', patient: H1, doc: 5, back: 60, time: '11:00', svc: 'C08', labs: [['L03', { GLU: 7.1 }], ['L04', { HBA1C: 7.3 }], ['L05', {}]], vitals: { bp_sys: 128, bp_dia: 82, pulse: 76, temp: 36.6 },
      note: tpl({ c: 'Shikoyat yo‘q.', a: 'Davoni muntazam qabul qilmoqda, uyda glyukometr bilan o‘lchaydi.', e: 'TVI 29 kg/m². Oyoq panjalari o‘zgarishsiz.',
        d: 'Qandli diabet, 2-tip, kompensatsiyaga yaqin', icd: ['E11.9'], r: 'Metformin 1000 mg kuniga 2 marta davom ettirilsin. Kuniga 30 daqiqa yurish. 3 oydan keyin HbA1c.', follow: 90 }) },
    // ---- H2: hypercholesterolaemia + hypertension on atorvastatin and amlodipine, LDL 4.9 → 3.7 → 2.8
    { key: 'h2a', patient: H2, doc: 1, back: 150, time: '09:00', svc: 'C03', extra: ['P01'], labs: [['L05', { LDL: 4.92, HDL: 1.18, TG: 2.41 }]], vitals: { bp_sys: 156, bp_dia: 94, pulse: 74, temp: 36.6 },
      note: tpl({ c: 'Ensada bosh og‘rig‘i, tez charchash.', a: 'Uyda AQB 160/95 gacha. Onasi 58 yoshida infarkt o‘tkazgan. Chekmaydi.', e: 'Yurak tonlari aniq, ritmik, aortada II ton aksenti. Oyoqlarda shish yo‘q.',
        d: 'Arterial gipertenziya, 2-daraja. Giperxolesterinemiya', icd: ['I10', 'E78.0'], r: 'Amlodipin 5 mg ertalab, atorvastatin 20 mg kechqurun, har kuni. Tuz kuniga 5 g gacha. 6 haftadan keyin lipid profil va ALT.', follow: 55 }) },
    { key: 'h2b', patient: H2, doc: 1, back: 95, time: '10:00', svc: 'C04', labs: [['L05', { LDL: 3.74, HDL: 1.24, TG: 1.98 }], ['L02', { ALT: 34, AST: 27 }]], vitals: { bp_sys: 138, bp_dia: 86, pulse: 70, temp: 36.5 },
      note: tpl({ c: 'Bosh og‘rig‘i kamaygan.', a: 'Amlodipin va atorvastatinni muntazam ichmoqda, nojo‘ya ta’sir yo‘q.', e: 'Yurak tonlari ritmik. Oyoqlarda shish yo‘q.',
        d: 'Arterial gipertenziya, 2-daraja, davo fonida. Giperxolesterinemiya', icd: ['I10', 'E78.0'], r: 'Davoni davom ettirish. ALT me’yorda. 2 oydan keyin lipid profil.', follow: 55 }) },
    { key: 'h2c', patient: H2, doc: 1, back: 40, time: '11:30', svc: 'C04', labs: [['L05', { LDL: 2.84, HDL: 1.31, TG: 1.62 }]], vitals: { bp_sys: 128, bp_dia: 80, pulse: 68, temp: 36.6 }, pay: 'partial',
      note: tpl({ c: 'Shikoyat yo‘q.', a: 'Amlodipin 5 mg va atorvastatin 20 mg ni muntazam ichmoqda. Yuradi, parhezga amal qiladi.', e: 'Yurak tonlari aniq, ritmik. Periferik shish yo‘q.',
        d: 'Arterial gipertenziya, 2-daraja, nazoratda. Giperxolesterinemiya, maqsadli LDL ga erishildi', icd: ['I10', 'E78.0'], r: 'Amlodipin 5 mg ertalab va atorvastatin 20 mg kechqurun davom ettirilsin. Hayvon yog‘larini cheklash, haftasiga 150 daqiqa yurish. 3 oydan keyin lipid profil.', follow: 90 }) },
    // ---- H3: iron-deficiency anaemia on oral iron, Hb 96 → 112 → 126, ferritin 6 → 15 → 34
    { key: 'h3a', patient: H3, doc: 0, back: 120, time: '15:30', svc: 'C01', labs: [['L01', { HGB: 96, RBC: 3.62, WBC: 6.1, PLT: 342, ESR: 21 }], ['L09', { FER: 6 }]], vitals: { bp_sys: 104, bp_dia: 66, pulse: 92, temp: 36.6 },
      note: tpl({ c: 'Holsizlik, bosh aylanishi, zinadan chiqqanda hansirash, soch to‘kilishi.', a: '3 oydan beri. Hayz ko‘p va 7 kun davom etadi. Go‘sht kam iste’mol qiladi.', e: 'Teri va shilliq qavatlar rangpar, tirnoqlar mo‘rt. Yurak cho‘qqisida yumshoq sistolik shovqin.',
        d: 'Temir tanqisligi anemiyasi, o‘rta og‘irlik', icd: ['D50.9'], r: 'Temir (III) gidroksid polimaltozat 100 mg kuniga 2 marta ovqatdan keyin, 3 oy. Ginekolog konsultatsiyasi (ko‘p hayz). 6 haftadan keyin UQT va ferritin.', follow: 45 }) },
    { key: 'h3b', patient: H3, doc: 0, back: 75, time: '16:00', svc: 'C02', labs: [['L01', { HGB: 112, RBC: 3.98, ESR: 15 }], ['L09', { FER: 15 }]], vitals: { bp_sys: 108, bp_dia: 68, pulse: 84, temp: 36.5 },
      note: tpl({ c: 'Holsizlik kamaygan, bosh aylanishi yo‘q.', a: 'Temir preparatini muntazam ichmoqda. Ginekolog ko‘rigida bo‘ldi.', e: 'Teri rangi yaxshilangan. Yurak tonlari ritmik.',
        d: 'Temir tanqisligi anemiyasi, yengil, davo fonida', icd: ['D50.9'], r: 'Temir preparatini davom ettirish. 6 haftadan keyin UQT va ferritin.', follow: 40 }) },
    { key: 'h3c', patient: H3, doc: 0, back: 35, time: '09:30', svc: 'C02', labs: [['L01', { HGB: 126, RBC: 4.31, ESR: 9 }], ['L09', { FER: 34 }]], vitals: { bp_sys: 112, bp_dia: 70, pulse: 76, temp: 36.6 },
      note: tpl({ c: 'Shikoyat yo‘q.', a: 'Temir preparatini 3 oy ichdi.', e: 'Teri va shilliq qavatlar odatiy rangda.',
        d: 'Temir tanqisligi anemiyasi, davolangan (remissiya)', icd: ['D50.9'], r: 'Temir preparatini yana 1 oy profilaktik dozada. Temirga boy ovqatlar. 3 oydan keyin UQT.', follow: 90 }) },
    // ---- H4: hypothyroidism on levothyroxine, TSH 9.6 → 5.4 → 2.3
    { key: 'h4a', patient: H4, doc: 5, back: 140, time: '15:00', svc: 'C08', labs: [['L06', { TSH: 9.62 }]], vitals: { bp_sys: 118, bp_dia: 76, pulse: 62, temp: 36.3 },
      note: tpl({ c: 'Holsizlik, uyquchanlik, sovuqqa chidamsizlik, vazn ortishi.', a: '6 oyda 5 kg ortgan. Opasida qalqonsimon bez kasalligi.', e: 'Teri quruq, yuz biroz shishgan. Qalqonsimon bez paypaslanmaydi.',
        d: 'Gipotireoz, birinchi aniqlangan', icd: ['E03.9'], r: 'Levotiroksin natriy 50 mkg ertalab och qoringa, nonushtadan 30 daqiqa oldin. 7 haftadan keyin TTG.', follow: 50 }) },
    { key: 'h4b', patient: H4, doc: 5, back: 90, time: '10:30', svc: 'C08', labs: [['L06', { TSH: 5.41 }]], vitals: { bp_sys: 116, bp_dia: 74, pulse: 66, temp: 36.5 },
      note: tpl({ c: 'Holsizlik kamaygan.', a: 'Levotiroksin 50 mkg ni muntazam ichmoqda.', e: 'Teri namligi yaxshilangan.',
        d: 'Gipotireoz, subkompensatsiya', icd: ['E03.9'], r: 'Levotiroksin natriy 75 mkg ga oshirildi, ertalab och qoringa. 7 haftadan keyin TTG.', follow: 52 }) },
    { key: 'h4c', patient: H4, doc: 5, back: 38, time: '09:00', svc: 'C08', labs: [['L06', { TSH: 2.27 }], ['L10', { VITD: 17 }]], vitals: { bp_sys: 118, bp_dia: 76, pulse: 70, temp: 36.6 },
      note: tpl({ c: 'Shikoyat yo‘q, ba’zan suyaklarda og‘riq.', a: 'Levotiroksin 75 mkg ni muntazam ichmoqda.', e: 'Somatik status o‘zgarishsiz. Qalqonsimon bez paypaslanmaydi.',
        d: 'Gipotireoz, kompensatsiya. D vitamini yetishmovchiligi', icd: ['E03.9', 'E55.9'], r: 'Levotiroksin 75 mkg davom ettirilsin. D vitamini bo‘yicha doza keyingi ko‘rikda. 6 oydan keyin TTG.', follow: 180 }) },
  ];

  // ---------- visits, notes, results, invoices ----------
  const made: Record<string, { apptId: string; encId: string; branch: string; start: Date; end: Date; patient: number; doc: number; invoiceId: string; orders: Row[] }> = {};
  let invSeq = 9000, rcpSeq = 49000;
  const queue: Record<string, number> = {};
  for (const s of [...SPECS].sort((a, b) => b.back - a.back || hm(a.time) - hm(b.time))) {
    const date = addDays(demoDate, -s.back);
    const sch = schedOf[`${s.doc}:${weekdayOf(date)}`];
    if (!sch) throw new Error(`seed history: doctor ${s.doc} does not work on ${date}`);
    const branch = sch.branch_id, p = patients[s.patient], D = docs[s.doc];
    const start = at(date, hm(s.time)), end = new Date(start.getTime() + svc[s.svc].duration_min * 60_000);
    const apptId = sid(`appt:hist:${s.key}`), encId = sid(`enc:${apptId}`), invoiceId = sid(`invoice:${apptId}`);
    const reg = registrarFor(branch);
    const created = new Date(start.getTime() - (2 + Math.floor(rnd() * 5)) * 86400_000 - Math.floor(rnd() * 300) * 60_000);
    data.appointments.push({ id: apptId, tenant_id: T, branch_id: branch, patient_id: p.id, doctor_id: SEED_IDS.doctor(s.doc), service_id: svc[s.svc].id, room_id: sch.room_id,
      starts_at: start, ends_at: end, status: 'completed', note: null, cancel_reason: null, version: 1, created_by: reg.id, created_at: created, updated_at: created });
    const arrived = new Date(start.getTime() - (6 + Math.floor(rnd() * 12)) * 60_000), started = new Date(start.getTime() + Math.floor(rnd() * 5) * 60_000);
    const qk = `${branch}:${date}`; queue[qk] = (queue[qk] ?? 0) + 1;
    data.queue_tickets.push({ id: sid(`queue:${apptId}`), tenant_id: T, branch_id: branch, appointment_id: apptId, local_date: date, number: queue[qk],
      arrived_at: arrived, started_at: started, finished_at: end, wait_seconds: Math.round((started.getTime() - arrived.getTime()) / 1000) });
    data.encounters.push({ id: encId, tenant_id: T, branch_id: branch, appointment_id: apptId, patient_id: p.id, doctor_id: SEED_IDS.doctor(s.doc), status: 'closed', started_at: started, closed_at: end });
    const n = s.note;
    data.clinical_notes.push({ id: sid(`note:${encId}`), tenant_id: T, encounter_id: encId, complaints: n.c, anamnesis: n.a, examination: n.e, diagnosis: n.d, recommendations: n.r,
      follow_up_date: n.follow ? addDays(date, n.follow) : null, vitals: s.vitals ?? {}, status: 'signed', version: 2, saved_at: end,
      signed_by: M.doctor(s.doc), signed_by_name: D.name, signed_at: end, icd10: icdSnap(n.icd) });
    audit(end, branch, { id: M.doctor(s.doc), name: D.name }, 'doctor', 'clinical_note.sign', 'encounter', encId, 'Klinik qayd tasdiqlandi');
    const orders: Row[] = [];
    const order = (key: string, code: string, at0: Date, performer: number, status: string, performedAt: Date | null, primary: boolean) => {
      const o = { id: sid(`order:hist:${key}`), tenant_id: T, branch_id: branch, patient_id: p.id, appointment_id: apptId, encounter_id: encId,
        service_id: svc[code].id, category: svc[code].category, service_name: svc[code].name, is_primary: primary, price_snapshot: priceAt(code, at0),
        share_percent_snapshot: sharePct(performer, code), doctor_id: SEED_IDS.doctor(s.doc), performer_doctor_id: SEED_IDS.doctor(performer),
        status, ordered_at: at0, performed_at: performedAt, created_by: primary ? reg.id : M.doctor(s.doc) };
      orders.push(o); return o;
    };
    order(`${s.key}:primary`, s.svc, arrived, s.doc, 'completed', end, true);
    for (const code of s.extra ?? []) order(`${s.key}:${code}`, code, new Date(start.getTime() + 12 * 60_000), s.doc, 'completed', new Date(start.getTime() + 25 * 60_000), false);
    const profiles = profilesOf(n.icd);
    s.labs.forEach(([code, fixed], j) => {
      const orderedAt = new Date(start.getTime() + 15 * 60_000);
      const collected = new Date(orderedAt.getTime() + (10 + Math.floor(rnd() * 20)) * 60_000);
      const verified = new Date(collected.getTime() + (120 + Math.floor(rnd() * 150)) * 60_000);
      const o = order(`${s.key}:lab:${j}`, code, orderedAt, 7, 'verified', verified, false);
      data.lab_results.push({ id: sid(`labres:${o.id}`), tenant_id: T, order_id: o.id, values: labValues(svc[code].lab_template, p.sex, x.ageOf(s.patient), profiles, rnd, fixed),
        comment: null, status: 'verified', collected_at: collected, collected_by_name: LAB.name, entered_by_name: LAB.name, entered_at: new Date(collected.getTime() + 3600_000),
        verified_by: LAB.id, verified_by_name: LAB.name, verified_at: verified });
      audit(verified, branch, LAB, 'lab', 'lab_result.verify', 'order', o.id, `${svc[code].name} tasdiqlandi`);
    });
    data.service_orders.push(...orders);
    // invoice: paid by card or cash after the visit; one stays partly unpaid (the 31+ days debtor)
    invSeq++;
    const items = orders.map((o, pos) => ({ id: sid(`item:${o.id}`), tenant_id: T, invoice_id: invoiceId, order_id: o.id, service_id: o.service_id, description: o.service_name,
      quantity: 1, unit_price: o.price_snapshot, line_subtotal: o.price_snapshot, discount_share: 0, line_total: o.price_snapshot, position: pos, refunded_amount: 0 }));
    const total = items.reduce((a, b) => a + b.line_total, 0);
    const paid = s.pay === 'partial' ? 150_000 * SO : total;
    data.invoices.push({ id: invoiceId, tenant_id: T, branch_id: branch, patient_id: p.id, appointment_id: apptId, invoice_number: invSeq,
      status: paid >= total ? 'paid' : 'partially_paid', subtotal: total, discount_type: null, discount_value: null, discount_amount: 0, discount_reason: null,
      discount_approved_by_name: null, total, paid_amount: paid, void_reason: null, version: 1, created_at: arrived, updated_at: arrived });
    data.invoice_items.push(...items);
    const cashier = cashierFor(branch);
    rcpSeq++;
    const payAt = new Date(end.getTime() + (4 + Math.floor(rnd() * 15)) * 60_000), payId = sid(`payment:${invoiceId}:hist`);
    const method = s.pay === 'partial' ? 'cash' : pick(['card', 'card', 'cash', 'transfer']);
    data.payments.push({ id: payId, tenant_id: T, branch_id: branch, invoice_id: invoiceId, receipt_number: rcpSeq, amount: paid, method,
      cashier_membership_id: cashier.id, cashier_name: cashier.name, paid_at: payAt, note: null, idempotency_key: `seed-${payId}`, request_hash: null, shift_id: null });
    audit(payAt, branch, cashier, 'cashier', 'payment.create', 'invoice', invoiceId, `To‘lov qayd etildi: ${(paid / SO).toLocaleString('ru-RU')} so‘m`);
    made[s.key] = { apptId, encId, branch, start, end, patient: s.patient, doc: s.doc, invoiceId, orders };
  }
  for (const [k, n] of Object.entries(queue)) { const [b, d] = k.split(':'); data.queue_counters.push({ branch_id: b, local_date: d, last_number: n }); }
  const visitOf = (k: string) => x.visits.find((v) => v.plan.fixedKey === k)!;
  const encMeta = (encId: string) => {
    const e = data.encounters.find((r) => r.id === encId)!;
    const a = data.appointments.find((r) => r.id === e.appointment_id)!;
    const doc = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => SEED_IDS.doctor(i) === e.doctor_id)!;
    const sv = Object.values(svc).find((r) => r.id === a.service_id)!;
    return { e, doc, meta: { doctor_name: docs[doc].name, specialty: docs[doc].spec, branch_name: branchName(e.branch_id), service_name: sv.name,
      visit_date: localDay(a.starts_at), visit_time: localTime(a.starts_at) } };
  };

  // ---------- visit documents ----------
  type Doc = { key: string; encId: string; kind: 'referral' | 'certificate' | 'prescription'; at: Date; body: Row; voided?: { at: Date; reason: string } };
  const docsOut: Doc[] = [];
  const rx = (name: string, inn: string, form: string, dose: string, frequency: string, duration: string, instructions: string | null = null) => ({ name, inn, form, dose, frequency, duration, instructions });
  const signedAt = (encId: string) => noteOf(encId).signed_at as Date;
  const after = (encId: string, min: number) => new Date(signedAt(encId).getTime() + min * 60_000);
  docsOut.push({ key: 'h1a-rx', encId: made.h1a.encId, kind: 'prescription', at: after(made.h1a.encId, 2), body: { items: [rx('Metformin', 'Metformin', 'tabletka', '500 mg', 'kuniga 1 marta kechki ovqat bilan; 2 haftadan keyin 1000 mg kuniga 2 marta', '3 oy', 'Ovqat bilan, suv bilan ichiladi')], notes: 'Parhez va jismoniy faollik bilan birga.' } });
  docsOut.push({ key: 'h2a-rx', encId: made.h2a.encId, kind: 'prescription', at: after(made.h2a.encId, 3), body: { items: [
    rx('Amlodipin', 'Amlodipine', 'tabletka', '5 mg', 'kuniga 1 marta ertalab', '3 oy'), rx('Atorvastatin', 'Atorvastatin', 'tabletka', '20 mg', 'kuniga 1 marta kechqurun', '3 oy')], notes: null } });
  docsOut.push({ key: 'h4a-rx', encId: made.h4a.encId, kind: 'prescription', at: after(made.h4a.encId, 2), body: { items: [rx('Levotiroksin natriy', 'Levothyroxine sodium', 'tabletka', '50 mkg', 'kuniga 1 marta ertalab och qoringa', '7 hafta', 'Nonushtadan 30 daqiqa oldin')], notes: null } });
  docsOut.push({ key: 'h3a-rx', encId: made.h3a.encId, kind: 'prescription', at: after(made.h3a.encId, 2), body: { items: [rx('Temir (III) gidroksid polimaltozat', 'Iron(III) hydroxide polymaltose', 'tabletka', '100 mg', 'kuniga 2 marta ovqatdan keyin', '3 oy', 'Choy bilan ichilmaydi')], notes: null } });
  docsOut.push({ key: 'h3a-ref', encId: made.h3a.encId, kind: 'referral', at: after(made.h3a.encId, 4), body: { to_specialty: 'Ginekolog', to_institution: null,
    reason: 'Temir tanqisligi anemiyasi; hayz ko‘p va uzoq davom etadi — sababini aniqlash', urgency: 'routine', icd10: icdSnap(['D50.9']), notes: 'Hb 96 g/L, ferritin 6 ng/mL.' } });
  docsOut.push({ key: 'h4b-rx-void', encId: made.h4b.encId, kind: 'prescription', at: after(made.h4b.encId, 2), voided: { at: after(made.h4b.encId, 6), reason: 'Doza noto‘g‘ri kiritildi (100 emas, 75 mkg) — qayta berildi' },
    body: { items: [rx('Levotiroksin natriy', 'Levothyroxine sodium', 'tabletka', '100 mkg', 'kuniga 1 marta ertalab och qoringa', '7 hafta')], notes: null } });
  docsOut.push({ key: 'h4b-rx', encId: made.h4b.encId, kind: 'prescription', at: after(made.h4b.encId, 7), body: { items: [rx('Levotiroksin natriy', 'Levothyroxine sodium', 'tabletka', '75 mkg', 'kuniga 1 marta ertalab och qoringa', '7 hafta', 'Nonushtadan 30 daqiqa oldin')], notes: null } });
  const aziz1 = visitOf('aziz1'), aziz2 = visitOf('aziz2');
  docsOut.push({ key: 'aziz1-ref', encId: aziz1.encounterId!, kind: 'referral', at: after(aziz1.encounterId!, 3), body: { to_specialty: 'Kardiolog', to_institution: null,
    reason: 'Arterial gipertenziya, birinchi aniqlangan; giperxolesterinemiya — kardiologik tekshiruv va davo tanlash', urgency: 'routine', icd10: icdSnap(['I10']), notes: null } });
  docsOut.push({ key: 'aziz2-rx', encId: aziz2.encounterId!, kind: 'prescription', at: after(aziz2.encounterId!, 3), body: { items: [
    rx('Amlodipin', 'Amlodipine', 'tabletka', '5 mg', 'kuniga 1 marta ertalab', '1 oy'), rx('Atorvastatin', 'Atorvastatin', 'tabletka', '20 mg', 'kuniga 1 marta kechqurun', '1 oy')],
    notes: 'AQB kundaligini yuritish, 2 haftadan keyin terapevt nazorati.' } });
  // certificates: a child with a cold (for the kindergarten) and an adult (for work; the patient asked for the diagnosis)
  const recentSigned = (doc: number, codes: string[]) => x.visits.filter((v) => v.plan.doc === doc && v.plan.status === 'completed' && v.encounterId && v.plan.date < demoDate && v.plan.date >= addDays(demoDate, -12)
    && (noteOf(v.encounterId).icd10 as Row[]).some((c) => codes.includes(c.code))).sort((a, b) => b.start.getTime() - a.start.getTime())[0];
  const kid = recentSigned(3, ['J06.9', 'J03.9', 'J20.9']);
  if (kid) docsOut.push({ key: 'kid-cert', encId: kid.encounterId!, kind: 'certificate', at: after(kid.encounterId!, 2), body: { purpose: 'Maktabgacha ta’lim tashkiloti (bog‘cha) uchun', include_diagnosis: false, rest_days: 3, notes: null } });
  const adult = recentSigned(0, ['J06.9', 'J20.9']);
  if (adult) docsOut.push({ key: 'adult-cert', encId: adult.encounterId!, kind: 'certificate', at: after(adult.encounterId!, 2), body: { purpose: 'Ish joyiga taqdim etish uchun', include_diagnosis: true, rest_days: 3, notes: 'Bemorning iltimosiga ko‘ra tashxis ko‘rsatildi.' } });
  docsOut.sort((a, b) => a.at.getTime() - b.at.getTime());
  docsOut.forEach((d, i) => {
    const { e, doc, meta } = encMeta(d.encId);
    const note = noteOf(d.encId);
    let body: Row = d.body;
    if (d.kind === 'certificate') {
      body = { ...body, diagnosis: body.include_diagnosis ? note.diagnosis : null, icd10: body.include_diagnosis ? note.icd10 : [],
        rest_from: body.rest_days ? meta.visit_date : null, rest_until: body.rest_days ? addDays(meta.visit_date, body.rest_days - 1) : null };
    }
    if (d.kind === 'prescription') body = { ...body, items: body.items.map((it: Row) => ({ ...it, drug_id: null, atc: null, prescription_only: false })),
      allergy_check: { warnings: [], override_reason: null, checked_at: d.at.toISOString() } };
    const id = sid(`document:${d.key}`);
    const who = { id: M.doctor(doc), name: docs[doc].name };
    data.medical_documents.push({ id, tenant_id: T, branch_id: e.branch_id, encounter_id: e.id, patient_id: e.patient_id, doctor_id: e.doctor_id, kind: d.kind, number: i + 1,
      body: { ...body, meta }, status: d.voided ? 'void' : 'issued', issued_at: d.at, issued_by: who.id, issued_by_name: who.name,
      void_reason: d.voided?.reason ?? null, voided_at: d.voided?.at ?? null, voided_by_name: d.voided ? who.name : null });
    const label = { referral: 'Yo‘llanma', certificate: 'Ma’lumotnoma', prescription: 'Retsept' }[d.kind];
    audit(d.at, e.branch_id, who, 'doctor', 'document.issue', 'document', id, `${label} №${i + 1} berildi`);
    if (d.voided) audit(d.voided.at, e.branch_id, who, 'doctor', 'document.void', 'document', id, `${label} №${i + 1} bekor qilindi`);
  });
  data.tenants.find((t) => t.id === T)!.document_seq = docsOut.length;
  for (const t of data.tenants) t.document_seq ??= 0;

  // ---------- approved patient summaries (plain language, from the signed note; never sent automatically) ----------
  const summary = (key: string, encId: string, text: string) => {
    const { e, doc } = encMeta(encId);
    const note = noteOf(encId);
    const approvedAt = new Date((note.signed_at as Date).getTime() + 9 * 60_000);
    const id = sid(`summary:${key}`);
    data.patient_summaries.push({ id, tenant_id: T, encounter_id: encId, note_id: note.id, patient_id: e.patient_id, doctor_id: e.doctor_id, branch_id: e.branch_id, version: 1,
      language: 'uz', text: text + (note.follow_up_date ? `\n\nKeyingi ko‘rik: ${dmy(note.follow_up_date)}.` : ''), draft_source: 'template',
      approved_by: M.doctor(doc), approved_by_name: docs[doc].name, approved_at: approvedAt, send_requested: false });
    audit(approvedAt, e.branch_id, { id: M.doctor(doc), name: docs[doc].name }, 'doctor', 'patient_summary.approve', 'encounter', encId, 'Bemor uchun xulosa tasdiqlandi (1-versiya)');
  };
  summary('h2c', made.h2c.encId, 'Bugungi ko‘rik natijasi: qon bosimingiz nazoratda, «yomon» xolesterin (LDL) maqsadli darajaga tushdi.\n\nNima qilish kerak:\n1. Amlodipin 5 mg ni har kuni ertalab ichishni davom ettiring.\n2. Atorvastatin 20 mg ni har kuni kechqurun ichishni davom ettiring.\n3. Hayvon yog‘larini cheklang, haftasiga kamida 150 daqiqa piyoda yuring.\n\nQachon darhol murojaat qilish kerak: ko‘krakda og‘riq, kuchli bosh og‘rig‘i yoki qon bosimi 180/110 dan oshsa.');
  summary('h1c', made.h1c.encId, 'Bugungi ko‘rik natijasi: qandli diabet nazorati sezilarli yaxshilandi, HbA1c pasaydi.\n\nNima qilish kerak:\n1. Metformin 1000 mg ni kuniga 2 marta ovqat bilan ichishni davom ettiring.\n2. Kuniga kamida 30 daqiqa yuring, shirinlik va oq nonni cheklang.\n3. Uyda glyukozani o‘lchab, natijalarni yozib boring.\n\nQachon darhol murojaat qilish kerak: kuchli chanqash, holsizlik yoki glyukoza 15 mmol/L dan yuqori bo‘lsa.');

  // ---------- addenda to signed notes ----------
  const addendum = (key: string, encId: string, when: Date, text: string, reason: string) => {
    const { e, doc } = encMeta(encId);
    data.note_addenda.push({ id: sid(`addendum:${key}`), tenant_id: T, encounter_id: encId, note_id: noteOf(encId).id, doctor_id: e.doctor_id, author_membership_id: M.doctor(doc),
      author_name: docs[doc].name, text, reason, created_at: when, signed_at: when });
    audit(when, e.branch_id, { id: M.doctor(doc), name: docs[doc].name }, 'doctor', 'clinical_note.addendum', 'encounter', encId, 'Tasdiqlangan qaydga qo‘shimcha yozuv qo‘shildi');
  };
  const azizLab = data.lab_results.find((r) => aziz1.orders.some((o) => o.id === r.order_id && o.category === 'lab') && r.status === 'verified');
  if (azizLab) addendum('aziz1', aziz1.encounterId!, new Date((azizLab.verified_at as Date).getTime() + 50 * 60_000), 'Umumiy qon tahlili tasdiqlandi — ko‘rsatkichlar me’yorda. Kardiolog ko‘rigiga yozildi.', 'Tahlil natijasi qo‘shildi');
  addendum('h2a', made.h2a.encId, new Date(made.h2a.end.getTime() + 40 * 60_000), 'EKG xulosasi: sinus ritmi, 72/daq, yurak elektr o‘qi normal, ishemik o‘zgarishlar yo‘q.', 'EKG natijasi qo‘shildi');
  if (kid) addendum('kid', kid.encounterId!, at(addDays(kid.plan.date, 2), hm('10:15')), 'Onasi telefon qildi: harorat 2-kuni me’yorga tushdi, yo‘tal kamaygan, ahvoli yaxshi.', 'Telefon orqali nazorat');
  if (x.plannedCritical) {
    const n = noteOf(x.plannedCritical.encounterId);
    addendum('critical', x.plannedCritical.encounterId, new Date((n.signed_at as Date).getTime() + 4 * 3600_000), x.plannedCritical.text, 'Kritik natija bo‘yicha qo‘shimcha');
  }

  // ---------- structured allergies (migration 028): doctor-confirmed classes and what patients told reception ----------
  const firstVisit = (i: number) => x.visits.filter((v) => v.plan.patient === i && v.encounterId && v.plan.date <= demoDate).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const MAP: Record<string, { cls: string | null; text: string | null; reaction: string; severity: string }> = {
    'Penitsillin': { cls: 'penicillins', text: null, reaction: 'Eshakyem (krapivnitsa)', severity: 'moderate' },
    'Aspirin': { cls: 'nsaids', text: null, reaction: 'Bronxospazm, nafas qisishi', severity: 'severe' },
    'Lidokain': { cls: 'local_anesthetics_amide', text: null, reaction: 'Bosh aylanishi, yurak urishi tezlashishi', severity: 'moderate' },
    'Sulfanilamidlar': { cls: 'sulfonamides', text: null, reaction: 'Teri toshmasi', severity: 'mild' },
    'Yong‘oq': { cls: null, text: 'Yong‘oq (oziq-ovqat)', reaction: 'Lab va til shishi', severity: 'moderate' },
    'Changlanish (mavsumiy)': { cls: null, text: 'Gul changi (mavsumiy)', reaction: 'Burun bitishi, aksirish, ko‘z qichishi', severity: 'mild' },
  };
  let ak = 0, nsaidsSeen = 0;
  for (const [i, p] of patients.entries()) {
    if (p.tenant_id !== T || p.allergy_state !== 'known') continue;
    const id = sid(`allergy:${p.id}`);
    if (i === AZIZ) {
      const v = visitOf('aziz1'), when = new Date(v.start.getTime() + 8 * 60_000);
      data.patient_allergies.push({ id, tenant_id: T, patient_id: p.id, class_code: 'penicillins', drug_id: null, free_text: null, reaction: 'Teri toshmasi, qichishish (amoksitsillindan, 2019)',
        severity: 'moderate', source: 'manual', recorded_by: M.doctor(0), recorded_by_name: docs[0].name, recorded_by_role: 'doctor', recorded_at: when, confirmed_at: when, confirmed_by_name: docs[0].name,
        withdrawn_at: null, withdrawn_by_name: null, withdraw_reason: null });
      continue;
    }
    const m = MAP[(p.allergy_note ?? '').split(' — ')[0]];
    if (!m) continue;
    ak++;
    const v = firstVisit(i);
    // every third: only the patient's words at the reception desk, waiting for a doctor's confirmation
    if (ak % 3 === 0 || !v) {
      data.patient_allergies.push({ id, tenant_id: T, patient_id: p.id, class_code: null, drug_id: null, free_text: `${p.allergy_note} — bemor aytdi`, reaction: null, severity: 'unknown',
        source: 'intake', recorded_by: M.registrar, recorded_by_name: 'Malika Yusupova', recorded_by_role: 'registrar', recorded_at: p.created_at, confirmed_at: null, confirmed_by_name: null,
        withdrawn_at: null, withdrawn_by_name: null, withdraw_reason: null });
      continue;
    }
    const D = docs[v.plan.doc], when = new Date(v.start.getTime() + 6 * 60_000);
    if (m.cls === 'nsaids') nsaidsSeen++;
    const withdraw = m.cls === 'nsaids' && nsaidsSeen === 2; // re-asked later: it was a stomach ache, not an allergy
    data.patient_allergies.push({ id, tenant_id: T, patient_id: p.id, class_code: m.cls, drug_id: null, free_text: m.text, reaction: m.reaction, severity: m.severity, source: 'manual',
      recorded_by: M.doctor(v.plan.doc), recorded_by_name: D.name, recorded_by_role: 'doctor', recorded_at: when, confirmed_at: when, confirmed_by_name: D.name,
      withdrawn_at: withdraw ? new Date(when.getTime() + 20 * 60_000) : null, withdrawn_by_name: withdraw ? D.name : null,
      withdraw_reason: withdraw ? 'Qayta so‘raldi: aspirindan keyin faqat oshqozon og‘rig‘i bo‘lgan, allergiya emas' : null });
  }

  // ---------- debts: promised payment dates (one already overdue), on the 31+ days and recent debtors ----------
  const inv = (apptId: string) => data.invoices.find((r) => r.appointment_id === apptId);
  const promise = (r: Row | undefined, back: number, note: string) => { if (!r || !['unpaid', 'partially_paid'].includes(r.status)) return; r.promise_date = addDays(demoDate, back); r.promise_note = note;
    audit(new Date((r.created_at as Date).getTime() + 40 * 60_000), r.branch_id, cashierFor(r.branch_id), 'cashier', 'invoice.promise', 'invoice', r.id, `Va’da: ${r.promise_date} — ${note}`); };
  promise(inv(made.h2c.apptId), -4, 'Pensiya kelgach to‘lashini aytdi');
  promise(inv(aziz2.apptId), 2, 'Telefon orqali kelishildi');
  const sherzod = x.visits.find((v) => v.plan.date === demoDate && v.plan.patient === 3);
  if (sherzod) promise(inv(sherzod.apptId), 3, 'Qoldiqni oylikdan keyin to‘laydi');
  const oldDebt = data.invoices.filter((r) => r.tenant_id === T && ['unpaid', 'partially_paid'].includes(r.status) && !r.promise_date && r.created_at < day(8, 0) && r.created_at >= day(30, 0))
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
  promise(oldDebt, 5, 'Bemor qo‘ng‘iroqqa javob berdi, haftada to‘laydi');

  // ---------- one refund: half of a consultation, after a complaint about the wait (manager, by card) ----------
  const refundable = data.invoices.filter((r) => r.tenant_id === T && r.status === 'paid' && r.created_at >= day(12, 0) && r.created_at < day(3, 0) && !r.discount_amount)
    .map((r) => ({ r, pays: data.payments.filter((p) => p.invoice_id === r.id) }))
    .filter(({ pays }) => pays.length === 1 && pays[0].method === 'card')
    .sort((a, b) => a.r.created_at.getTime() - b.r.created_at.getTime())[0];
  let refundSeq = 0;
  if (refundable) {
    const { r, pays } = refundable;
    const item = data.invoice_items.find((it) => it.invoice_id === r.id && data.service_orders.find((o) => o.id === it.order_id)?.is_primary)!;
    const amount = Math.floor(item.line_total / 2 / (5_000 * SO)) * 5_000 * SO;
    const when = new Date((pays[0].paid_at as Date).getTime() + 26 * 3600_000);
    refundSeq = 1;
    const id = sid('refund:1');
    data.refunds.push({ id, tenant_id: T, branch_id: r.branch_id, invoice_id: r.id, payment_id: pays[0].id, refund_number: 1, amount, method: 'card', reason_code: 'patient_complaint',
      reason: 'Navbatda 1 soatdan ortiq kutdi — rahbar qarori bilan konsultatsiya narxining yarmi qaytarildi', shift_id: null, approved_by: MANAGER.id, approved_by_name: MANAGER.name,
      refunded_at: when, idempotency_key: 'seed-refund-1', order_id: item.order_id });
    item.refunded_amount = amount;
    r.credit_amount = amount; r.refunded_amount = amount; r.line_refunded_amount = amount;
    r.total -= amount; r.paid_amount -= amount; r.updated_at = when; r.version = 2;
    audit(when, r.branch_id, MANAGER, 'manager', 'refund.create', 'invoice', r.id, `Qaytarildi: ${(amount / SO).toLocaleString('ru-RU')} so‘m (Karta), №1, xizmat: ${data.service_orders.find((o) => o.id === item.order_id)!.service_name}, sabab: Bemor shikoyati`);
  }
  data.tenants.find((t) => t.id === T)!.refund_seq = refundSeq;
  // every invoice row carries the same columns (the loader takes the column list from the first row)
  for (const r of data.invoices) { r.promise_date ??= null; r.promise_note ??= null; r.credit_amount ??= 0; r.refunded_amount ??= 0; r.line_refunded_amount ??= 0; }
  for (const it of data.invoice_items) it.refunded_amount ??= 0;

  // ---------- deposits (prepayments) taken this morning in the open shifts: a liability, not revenue ----------
  const shiftOf = (b: string) => data.cash_shifts.find((s) => s.branch_id === b && s.status === 'open')!;
  const deposit = (key: string, patientIdx: number, branch: string, time: string, amount: number, method: string, note: string) => {
    if (hm(time) > demoNowMin) return;
    const sh = shiftOf(branch), when = at(demoDate, hm(time)), cashier = cashierFor(branch), p = patients[patientIdx];
    data.patient_deposits.push({ id: sid(`deposit:${key}`), tenant_id: T, branch_id: branch, patient_id: p.id, kind: 'in', amount: amount * SO, method, shift_id: sh.id,
      invoice_id: null, payment_id: null, note, actor_membership_id: cashier.id, actor_name: cashier.name, occurred_at: when, idempotency_key: `seed-deposit-${key}` });
    audit(when, branch, cashier, 'cashier', 'deposit.create', 'patient', p.id, `Oldindan to‘lov: ${amount.toLocaleString('ru-RU')} so‘m (${method === 'cash' ? 'Naqd' : method === 'card' ? 'Karta' : 'O‘tkazma'})`);
  };
  const futureAkmal = data.appointments.filter((a) => a.doctor_id === SEED_IDS.doctor(0) && a.status === 'scheduled' && a.starts_at >= at(addDays(demoDate, 1), 0))
    .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())[0];
  const futureIdx = futureAkmal ? patients.findIndex((p) => p.id === futureAkmal.patient_id) : H3;
  deposit('course', futureIdx, BC, '08:40', 450_000, 'card', 'Tomchi muolajasi kursi (5 ta) uchun oldindan to‘lov');
  deposit('labs', H1, BY, '09:15', 200_000, 'cash', 'Keyingi tahlillar uchun oldindan to‘lov');

  // ---------- schedule exceptions: a vacation that matches the camera log, a day off, a short day, public holidays ----------
  const futureFree = (doc: number) => { for (let d = 2; d <= 6; d++) { const date = addDays(demoDate, d); if (schedOf[`${doc}:${weekdayOf(date)}`] && !data.appointments.some((a) => a.doctor_id === SEED_IDS.doctor(doc) && localDay(a.starts_at) === date)) return date; } return null; };
  const ex = (key: string, row: Partial<Row>) => data.schedule_exceptions.push({ id: sid(`schedex:${key}`), tenant_id: T, doctor_id: null, branch_id: null, start_time: null, end_time: null, note: null,
    created_by: MANAGER.id, created_at: day(20, hm('17:10')), ...row });
  for (let b = x.lolaLeave[0]; b >= x.lolaLeave[1]; b--) ex(`lola:${b}`, { doctor_id: SEED_IDS.doctor(4), date: addDays(demoDate, -b), kind: 'vacation', note: 'Yillik ta’til', created_at: day(x.lolaLeave[0] + 9, hm('16:30')) });
  const kamolaOff = futureFree(6);
  if (kamolaOff) ex('kamola', { doctor_id: SEED_IDS.doctor(6), date: kamolaOff, kind: 'day_off', note: 'Malaka oshirish kursi', created_at: day(3, hm('15:20')) });
  const sardorShort = futureFree(5);
  if (sardorShort) ex('sardor', { doctor_id: SEED_IDS.doctor(5), date: sardorShort, kind: 'custom_hours', start_time: '08:00', end_time: '13:00', note: 'Tushdan keyin endokrinologlar konferensiyasi', created_at: day(2, hm('12:05')) });
  const year = Number(demoDate.slice(0, 4));
  const next = (md: string) => (`${year}-${md}` > demoDate ? `${year}-${md}` : `${year + 1}-${md}`);
  ex('holiday:constitution', { date: next('12-08'), kind: 'holiday', note: 'Konstitutsiya kuni — klinika dam oladi', created_at: day(25, hm('10:00')) });
  ex('holiday:newyear', { date: next('01-01'), kind: 'holiday', note: 'Yangi yil', created_at: day(25, hm('10:01')) });
  for (const r of data.schedule_exceptions) audit(r.created_at, null, MANAGER, 'manager', 'schedule.exception.create', 'schedule_exception', r.id, `Ish jadvalidan istisno: ${r.date}`);

  // ---------- notification consents (SMS/Telegram reminders): given on paper; one patient said no later ----------
  for (const p of patients) {
    if (p.tenant_id !== T || !p.phone || ![2, 4, 5].includes(p.patient_number % 10)) continue;
    data.patient_consents.push({ id: sid(`consent:notify:${p.id}`), tenant_id: T, patient_id: p.id, kind: 'notifications', granted: true, text_version: '2026-10', method: 'signed_paper',
      recorded_by: M.registrar, recorded_by_name: 'Malika Yusupova', recorded_at: p.created_at, note: null });
  }
  const optOut = [...patients].reverse().find((p) => p.tenant_id === T && p.phone && p.patient_number % 10 === 5);
  if (optOut) data.patient_consents.push({ id: sid(`consent:notify:off:${optOut.id}`), tenant_id: T, patient_id: optOut.id, kind: 'notifications', granted: false, text_version: '2026-10', method: 'verbal',
    recorded_by: M.registrar, recorded_by_name: 'Malika Yusupova', recorded_at: day(6, hm('10:20')), note: 'Eslatmalar kerak emasligini aytdi' });

  data.audit_logs.sort((a, b) => (a.occurred_at as Date).getTime() - (b.occurred_at as Date).getTime());
  return { trend: { H1, H2, H3, H4 } };
}
