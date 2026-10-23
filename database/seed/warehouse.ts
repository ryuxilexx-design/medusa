/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDays, DEMO_TIMEZONE_OFFSET_HOURS, SEED_IDS, sid, type SeedData } from './build';

type Row = Record<string, any>;
const SO = 100;
/** Local Tashkent date + minutes since midnight -> UTC Date */
function at(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - DEMO_TIMEZONE_OFFSET_HOURS * 3600_000);
}
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
/** Tashkent calendar day of an instant. */
const localDay = (d: Date) => new Date(d.getTime() + DEMO_TIMEZONE_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);

/** Seed items linked to the drug reference (drugs ids are generated in the database, so the link is set after insert). */
export const seedDrugLinks = (): [string, string][] =>
  ['Tramadol', 'Ceftriaxone', 'Lidocaine', 'Sodium chloride', 'Insulin (human)', 'Dexamethasone'].map((inn, k) => [sid(`inv:med:${k}`), inn]);

/**
 * The demo warehouse. Existing items get their balance split into batches (series, expiry: one lot near expiry, one
 * expired); six medicines arrive with two supplier receipts; doctors' requests are issued FEFO with patient, visit and
 * ICD-10 code; tramadol (controlled) has its register with two signatures and a return; a write-off act waits for the
 * manager; the fridge has a twice-daily log. Deterministic and RNG-free (the seeded KPIs do not move).
 * Invariant: opening_qty + Σ ledger = Σ batch balances.
 */
export function buildWarehouse(data: SeedData, demoDate: string, demoTime?: string) {
  const T = SEED_IDS.tenant, BC = SEED_IDS.branchCentral, M = SEED_IDS.membership;
  const KEEPER = { id: M.storekeeper, name: 'Sherzod Qodirov' };
  const MANAGER = { id: M.manager, name: 'Dilnoza Karimova' };
  const C = (v: number | string) => Math.round(Number(v) * 100);
  const q2 = (c: number) => (c / 100).toFixed(2);
  const val = (qtyC: number, cost: number) => Math.round((qtyC * cost) / 100);
  const day = (d: number, min: number) => at(addDays(demoDate, d), min);
  const demoNowMin = demoTime && /^\d{2}:\d{2}$/.test(demoTime) ? hm(demoTime) : 11 * 60 + 30;

  // ---- existing consumables and reagents: categories, prices, two batches each
  const PRICE_SOM = [1_200, 1_500, 300, 2_200, 2_200, 450_000, 85_000, 260_000, 120_000, 18_000, 900, 600, 4_500, 400, 35_000, 900, 6_000, 9_000, 1_800, 22_000];
  const REAGENT = new Set([5, 6, 7]);
  const batches: Row[] = [];
  data.inventory_items.forEach((it, i) => {
    it.category = REAGENT.has(i) ? 'reagent' : 'consumable';
    it.storage = i === 5 || i === 7 ? 'fridge' : 'room';
    it.controlled = false; it.drug_id = null;
    it.purchase_price = (PRICE_SOM[i] ?? 1_000) * SO;
    const net = data.inventory_movements.filter((m) => m.item_id === it.id).reduce((a, m) => a + (m.type === 'in' ? C(m.quantity) : -C(m.quantity)), C(it.opening_qty));
    // the older lot expires first; test strips run out soon, one calibrator lot is already expired
    let older = Math.round((net * 0.35) / 100) * 100;
    let olderExp = addDays(demoDate, 45 + ((i * 37) % 300));
    if (i === 6) { older = C(2); olderExp = addDays(demoDate, 20); }
    if (i === 7) { older = C(2); olderExp = addDays(demoDate, -5); }
    [{ c: older, exp: olderExp, rec: -60 }, { c: net - older, exp: addDays(demoDate, 380 + ((i * 29) % 300)), rec: -25 }].filter((p) => p.c > 0).forEach((p, j) =>
      batches.push({ id: sid(`batch:${i}:${j}`), tenant_id: T, item_id: it.id, batch_no: `S${2500 + i * 7 + j}`, expiry_date: p.exp, qty: '0', qtyC: p.c, received_qty: q2(p.c),
        unit_cost: it.purchase_price, supplier: 'Medtexnika Servis (demo)', invoice_no: null, receipt_id: null, received_at: day(p.rec, hm('10:00')) }));
  });

  // ---- six medicines (Central branch), arriving with two receipts
  const MEDS = [
    { name: 'Tramadol 50 mg/ml, 2 ml', unit: 'ampula', price: 9_500, min: 5, controlled: true, storage: 'room' },
    { name: 'Seftriakson 1 g', unit: 'flakon', price: 12_000, min: 20, controlled: false, storage: 'room' },
    { name: 'Lidokain 2%, 2 ml', unit: 'ampula', price: 2_500, min: 20, controlled: false, storage: 'room' },
    { name: 'Natriy xlorid 0,9%, 200 ml', unit: 'flakon', price: 8_000, min: 15, controlled: false, storage: 'room' },
    { name: 'Insulin (qisqa ta’sirli), 10 ml', unit: 'flakon', price: 95_000, min: 2, controlled: false, storage: 'fridge' },
    { name: 'Deksametazon 4 mg/ml, 1 ml', unit: 'ampula', price: 3_000, min: 10, controlled: false, storage: 'room' },
  ];
  const medId = (k: number) => sid(`inv:med:${k}`);
  MEDS.forEach((m, k) => data.inventory_items.push({ id: medId(k), tenant_id: T, branch_id: BC, name: m.name, unit: m.unit, opening_qty: 0, minimum_qty: m.min, active: true,
    category: 'medicine', storage: m.storage, controlled: m.controlled, drug_id: null, purchase_price: m.price * SO }));
  const RECEIPTS: { n: number; d: number; supplier: string; inv: string; lines: [number, string, number, number][] }[] = [
    { n: 1, d: -20, supplier: 'Grand Pharm (demo)', inv: 'GP-4471', lines: [[0, 'TR-2601', 300, 20], [1, 'SF-2509', 25, 50], [2, 'LD-2603', 200, 100], [3, 'NC-2512', 60, 40], [5, 'DX-2604', 400, 30]] },
    { n: 2, d: -6, supplier: 'Dori-Darmon (demo)', inv: 'DD-1185', lines: [[1, 'SF-2604', 500, 40], [4, 'IN-2605', 150, 6], [3, 'NC-2606', 330, 30]] },
  ];
  for (const r of RECEIPTS) {
    const id = sid(`receipt:${r.n}`); const when = day(r.d, hm('09:40'));
    let total = 0;
    r.lines.forEach(([k, series, exp, qty], j) => {
      const cost = MEDS[k].price * SO; const qc = C(qty); total += val(qc, cost);
      const bid = sid(`batch:med:${r.n}:${j}`);
      batches.push({ id: bid, tenant_id: T, item_id: medId(k), batch_no: series, expiry_date: addDays(demoDate, exp), qty: '0', qtyC: qc, received_qty: q2(qc), unit_cost: cost,
        supplier: r.supplier, invoice_no: r.inv, receipt_id: id, received_at: when });
      data.inventory_movements.push(move({ id: sid(`whmv:rc:${r.n}:${j}`), item_id: medId(k), type: 'in', quantity: q2(qc), reason: `Kirim K-${r.n}: ${r.supplier}, nakladnaya ${r.inv}`,
        occurred_at: when, kind: 'receipt', batch_id: bid, unit_cost: cost, value: val(qc, cost), doc_no: `K-${r.n}`, receipt_id: id }));
    });
    data.inventory_receipts.push({ id, tenant_id: T, branch_id: BC, number: r.n, supplier: r.supplier, invoice_no: r.inv, invoice_date: addDays(demoDate, r.d - 1), note: null, total,
      received_by: KEEPER.id, received_by_name: KEEPER.name, received_at: when });
  }
  /** One ledger row with every column present (the seed loader takes the column list from the first row). */
  function move(m: Row): Row {
    return { tenant_id: T, branch_id: BC, actor_name: KEEPER.name, actor_membership_id: KEEPER.id, receiver_membership_id: null, receiver_name: null, purpose: null, patient_id: null,
      encounter_id: null, order_id: null, icd_codes: [], department: null, request_id: null, receipt_id: null, return_of: null, second_signer_membership_id: null, second_signer_name: null, ...m };
  }

  // ---- requests: issued FEFO from the batches above
  const docIdx = (doctorId: string) => [0, 1, 2, 3, 4, 5, 6, 7].find((i) => SEED_IDS.doctor(i) === doctorId) ?? 0;
  const DOC_NAMES = ['Akmal Rasulov', 'Feruza Mirzayeva', 'Bekzod Ergashev', 'Zarina Xolmatova', 'Lola Abdullayeva', 'Sardor Nazarov', 'Kamola Ismoilova', 'Otabek Qodirov'];
  const ICD_BY_DOC = ['J06.9', 'I10', 'M54.5', 'J20.9', 'N76.0', 'E11.9', 'R51', 'R51'];
  const byTime = (k: string) => (a: Row, b: Row) => a[k].getTime() - b[k].getTime() || (a.id < b.id ? -1 : 1);
  const closed = data.encounters.filter((e) => e.branch_id === BC && e.status === 'closed' && e.started_at >= day(-10, 0) && e.started_at < day(0, 0)).sort(byTime('started_at'));
  const procOrders = data.service_orders.filter((o) => o.branch_id === BC && o.category === 'procedure' && o.encounter_id && o.status === 'completed' && o.ordered_at >= day(-10, 0) && o.ordered_at < day(0, 0))
    .sort(byTime('ordered_at'));
  const openToday = data.encounters.filter((e) => e.branch_id === BC && e.status === 'open' && e.started_at >= day(0, 0)).sort(byTime('started_at'));
  const encOf = (id: string) => data.encounters.find((e) => e.id === id)!;
  const itemOf = (id: string) => data.inventory_items.find((x) => x.id === id)!;
  const LEG = (i: number) => sid(`inv:${i}`);
  const docOf = (e: Row) => ({ id: M.doctor(docIdx(e.doctor_id)), name: DOC_NAMES[docIdx(e.doctor_id)], role: 'doctor' });
  let reqN = 0;
  type Line = [string, number, number?]; // item, requested, issued (default = requested)
  const request = (o: { when: Date; requester: { id: string; name: string; role: string }; department: string; purpose: 'patient' | 'procedure' | 'department'; enc?: Row; order?: Row;
    lines: Line[]; status: string; approve?: boolean; issuedAfterMin?: number }) => {
    reqN++;
    const id = sid(`whreq:${reqN}`);
    const enc = o.purpose === 'department' ? undefined : o.enc ?? encOf(o.order!.encounter_id);
    const icd = enc ? [ICD_BY_DOC[docIdx(enc.doctor_id)]] : [];
    const issueAt = new Date(o.when.getTime() + (o.issuedAfterMin ?? 15) * 60_000);
    const needsApproval = o.lines.some(([it]) => itemOf(it).controlled);
    const done = o.status === 'issued';
    data.inventory_requests.push({ id, tenant_id: T, branch_id: BC, number: reqN, requester_membership_id: o.requester.id, requester_name: o.requester.name, requester_role: o.requester.role,
      department: o.department, purpose: o.purpose, patient_id: enc?.patient_id ?? null, encounter_id: enc?.id ?? null, order_id: o.order?.id ?? null, icd_codes: icd, note: null,
      direct: false, status: o.status, needs_approval: needsApproval, approved_by: o.approve ? MANAGER.id : null, approved_by_name: o.approve ? MANAGER.name : null,
      approved_at: o.approve ? new Date(o.when.getTime() + 5 * 60_000) : null, created_at: o.when, submitted_at: o.when,
      closed_at: done ? issueAt : null, closed_by_name: done ? KEEPER.name : null, reject_reason: null });
    o.lines.forEach(([itemId, qty, issuedQty], j) => {
      const give = o.status === 'submitted' ? 0 : C(issuedQty ?? qty);
      data.inventory_request_lines.push({ id: sid(`whreq:${reqN}:${j}`), tenant_id: T, request_id: id, item_id: itemId, qty: q2(C(qty)), issued_qty: q2(give) });
      let left = give;
      const fefo = batches.filter((b) => b.item_id === itemId && b.qtyC > 0 && b.expiry_date >= localDay(issueAt))
        .sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : a.expiry_date > b.expiry_date ? 1 : a.received_at.getTime() - b.received_at.getTime()));
      for (const b of fefo) {
        if (left <= 0) break;
        const take = Math.min(left, b.qtyC); b.qtyC -= take; left -= take;
        const ctrl = itemOf(itemId).controlled;
        data.inventory_movements.push(move({ id: sid(`whmv:is:${reqN}:${j}:${b.id}`), item_id: itemId, type: 'out', quantity: q2(take), reason: `Talabnoma T-${reqN}`,
          occurred_at: issueAt, kind: 'issue', batch_id: b.id, receiver_membership_id: o.requester.id, receiver_name: o.requester.name, purpose: o.purpose,
          patient_id: enc?.patient_id ?? null, encounter_id: enc?.id ?? null, order_id: o.order?.id ?? null, icd_codes: icd, department: o.department, request_id: id,
          unit_cost: b.unit_cost, value: val(take, b.unit_cost), doc_no: `T-${reqN}`,
          second_signer_membership_id: ctrl ? MANAGER.id : null, second_signer_name: ctrl ? MANAGER.name : null }));
      }
      if (left > 0) throw new Error(`seed warehouse: not enough «${itemOf(itemId).name}»`);
    });
    return id;
  };
  if (closed.length) {
    const visit = (k: number) => closed[Math.min(k, closed.length - 1)];
    request({ when: new Date(visit(0).started_at.getTime() + 10 * 60_000), requester: docOf(visit(0)), department: 'Muolaja xonasi', purpose: 'patient', enc: visit(0),
      lines: [[medId(1), 2], [medId(2), 2], [LEG(0), 2]], status: 'issued' });
    request({ when: new Date(visit(3).started_at.getTime() + 12 * 60_000), requester: docOf(visit(3)), department: 'Muolaja xonasi', purpose: 'patient', enc: visit(3),
      lines: [[medId(3), 1], [medId(5), 2]], status: 'issued' });
    // tramadol for an injection: the manager signs first, the storekeeper issues (two signatures)
    const ord = procOrders[0], ord2 = procOrders.length > 1 ? procOrders[procOrders.length - 1] : undefined;
    if (ord) request({ when: new Date(ord.ordered_at.getTime() + 5 * 60_000), requester: docOf(encOf(ord.encounter_id)), department: 'Muolaja xonasi',
      purpose: 'procedure', order: ord, lines: [[medId(0), 1], [medId(2), 1]], status: 'issued', approve: true, issuedAfterMin: 20 });
    const ref = ord2 ? encOf(ord2.encounter_id) : visit(6);
    const trReq = request({ when: new Date((ord2 ? ord2.ordered_at : ref.started_at).getTime() + 5 * 60_000), requester: docOf(ref), department: 'Muolaja xonasi',
      purpose: ord2 ? 'procedure' : 'patient', order: ord2, enc: ord2 ? undefined : ref, lines: [[medId(0), 2]], status: 'issued', approve: true, issuedAfterMin: 20 });
    // one ampoule came back unused: the return goes to the same batch and keeps doctor, patient and purpose
    const issued = data.inventory_movements.find((m) => m.request_id === trReq && m.kind === 'issue');
    if (issued) {
      batches.find((x) => x.id === issued.batch_id)!.qtyC += C(1);
      data.inventory_movements.push({ ...issued, id: sid('whmv:return:1'), type: 'in', kind: 'return', quantity: q2(C(1)), value: val(C(1), issued.unit_cost), reason: 'Qaytarildi: ishlatilmadi, ampula butun',
        occurred_at: new Date(issued.occurred_at.getTime() + 3 * 3600_000), return_of: issued.id, second_signer_membership_id: null, second_signer_name: null });
    }
    request({ when: day(-3, hm('08:30')), requester: { id: M.doctor(0), name: DOC_NAMES[0], role: 'doctor' }, department: 'Muolaja xonasi', purpose: 'department',
      lines: [[LEG(2), 100]], status: 'issued' });
    request({ when: new Date(visit(8).started_at.getTime() + 15 * 60_000), requester: docOf(visit(8)), department: 'Kunduzgi statsionar', purpose: 'patient', enc: visit(8),
      lines: [[medId(1), 10, 6]], status: 'partially_issued' });
  }
  if (openToday.length && openToday[0].started_at.getTime() + 5 * 60_000 <= day(0, demoNowMin).getTime())
    request({ when: new Date(openToday[0].started_at.getTime() + 5 * 60_000), requester: docOf(openToday[0]), department: 'Muolaja xonasi', purpose: 'patient', enc: openToday[0],
      lines: [[medId(2), 2], [medId(3), 1]], status: 'submitted' });
  if (demoNowMin > hm('08:00'))
    request({ when: day(0, hm('08:00')), requester: { id: M.lab, name: 'Gulnora Saidova', role: 'lab' }, department: 'Laboratoriya', purpose: 'department', lines: [[LEG(5), 1]], status: 'submitted' });

  // ---- write-off act: the expired calibrator lot, drawn up by the storekeeper, waiting for the manager
  const expired = batches.find((b) => b.expiry_date < demoDate && b.qtyC > 0);
  if (expired) {
    const wid = sid('writeoff:1');
    data.inventory_writeoffs.push({ id: wid, tenant_id: T, branch_id: BC, number: 1, reason: 'expired', note: 'Yaroqlilik muddati o‘tgan, karantin javonida',
      commission: ['Sherzod Qodirov', 'Gulnora Saidova', 'Feruza Mirzayeva'], status: 'pending', controlled: false, created_by: KEEPER.id, created_by_name: KEEPER.name,
      created_at: day(-1, hm('16:00')), total: val(expired.qtyC, expired.unit_cost) });
    data.inventory_writeoff_lines.push({ id: sid('writeoff:1:0'), tenant_id: T, writeoff_id: wid, batch_id: expired.id, qty: q2(expired.qtyC) });
  }
  for (const b of batches) { const { qtyC, ...row } = b; data.inventory_batches.push({ ...row, qty: q2(qtyC) }); }
  // the legacy rows (before 030) need every column of the warehouse rows: the loader takes the column list from the first row
  data.inventory_movements = data.inventory_movements.map((m) => (m.kind ? m : move({ ...m, kind: 'legacy', batch_id: null, actor_membership_id: null, unit_cost: 0, value: 0, doc_no: null })));
  data.inventory_doc_counters.push({ tenant_id: T, kind: 'receipt', last: RECEIPTS.length }, { tenant_id: T, kind: 'request', last: reqN }, { tenant_id: T, kind: 'writeoff', last: expired ? 1 : 0 });

  // ---- fridge log, twice a day; one reading out of range three days ago
  for (let d = -6; d <= 0; d++) for (const [t, base] of [[hm('08:00'), 4.2], [hm('18:00'), 5.1]] as const) {
    if (d === 0 && t > demoNowMin) continue;
    const temp = d === -3 && t === hm('18:00') ? 9.1 : Number((base + ((((d + 7) * 3 + (t === hm('08:00') ? 0 : 1)) % 5) * 0.4)).toFixed(1));
    data.fridge_temperature_log.push({ id: sid(`fridge:${d}:${t}`), tenant_id: T, branch_id: BC, fridge: 'Muzlatkich №1 (dorilar)', recorded_at: day(d, t), temperature: temp,
      recorded_by: KEEPER.id, recorded_by_name: KEEPER.name, note: temp > 8 ? 'Eshik ochiq qolgan, yopildi; 30 daqiqadan keyin 6,0 °C' : null });
  }
}
