// Warehouse stock rules shared by the warehouse and inventory controllers (docs/WAREHOUSE.md).
// Every quantity change happens inside db.tx: the item rows are locked FOR UPDATE first (sorted, so two transactions
// never deadlock), only then are batch balances read — «read a quantity only after locking its row».
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { conflict, forbidden, invalid, notFound } from '../core/errors';
import { addDays, dayStart, now, today } from '../core/clock';

/** numeric(12,2) ⇄ integer hundredths: never add quantities in floating point. */
export const toC = (v: unknown) => Math.round(Number(v ?? 0) * 100);
export const fromC = (c: number) => (c / 100).toFixed(2);
/** round(quantity × unit cost) in whole tiyin, exact (BigInt). */
export const valueOf = (qtyC: number, unitCost: number | string) => ((BigInt(qtyC) * BigInt(unitCost) + 50n) / 100n).toString();

/** Stock of an item = Σ batch balances. */
export const STOCK_SQL = (alias = 'i') => `coalesce((SELECT sum(b.qty) FROM inventory_batches b WHERE b.item_id = ${alias}.id),0)`;
/** Usable stock: batches that are not expired on the demo day. */
export const USABLE_SQL = (alias = 'i') => `coalesce((SELECT sum(b.qty) FROM inventory_batches b WHERE b.item_id = ${alias}.id AND (b.expiry_date IS NULL OR b.expiry_date >= ((SELECT demo_now()) AT TIME ZONE 'Asia/Tashkent')::date)),0)`;

export type DocKind = 'receipt' | 'request' | 'writeoff' | 'count' | 'issue';
export async function nextNumber(c: Q, tenantId: string, kind: DocKind): Promise<number> {
  return (await c.query(
    `INSERT INTO inventory_doc_counters (tenant_id, kind, last) VALUES ($1,$2,1)
     ON CONFLICT (tenant_id, kind) DO UPDATE SET last = inventory_doc_counters.last + 1 RETURNING last`, [tenantId, kind])).rows[0].last;
}
export const DOC_PREFIX: Record<DocKind, string> = { receipt: 'K', request: 'T', writeoff: 'A', count: 'I', issue: 'T' };

/** Locks the items (sorted ids) of one branch of this tenant; a missing or foreign item is a 422 on its line. */
export async function lockItems(c: Q, ctx: Ctx, branchId: string, itemIds: string[]) {
  const ids = [...new Set(itemIds)].sort();
  const rows = (await c.query(
    `SELECT id, name, unit, branch_id, controlled, active, category, purchase_price FROM inventory_items
      WHERE id = ANY($1::uuid[]) AND tenant_id = $2 ORDER BY id FOR UPDATE`, [ids, ctx.tenantId])).rows;
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  itemIds.forEach((id, i) => {
    const it = byId.get(id);
    if (!it) throw invalid({ [`lines.${i}.item_id`]: 'Material topilmadi' });
    if (it.branch_id !== branchId) throw invalid({ [`lines.${i}.item_id`]: 'Material boshqa filial omborida' });
  });
  return byId;
}

/**
 * B1 (audit 2026-10-25): while an inventory count is open its batches are being counted — any quantity change of a
 * counted item (receipt, issue, return, write-off, void) would make «counted − expected» wrong, so it waits (409). Call it
 * after the items are locked: a count that starts later locks the same rows first (startCount), so the two serialise.
 */
export async function assertNotCounting(c: Q, tenantId: string, itemIds: string[]) {
  if (!itemIds.length) return;
  const hit = (await c.query(
    `SELECT c.number, i.name FROM inventory_counts c JOIN inventory_count_lines l ON l.count_id = c.id JOIN inventory_batches b ON b.id = l.batch_id JOIN inventory_items i ON i.id = b.item_id
      WHERE c.tenant_id = $1 AND c.status = 'open' AND b.item_id = ANY($2::uuid[]) LIMIT 1`, [tenantId, [...new Set(itemIds)]])).rows[0];
  if (hit) throw conflict('COUNT_IN_PROGRESS', `Inventarizatsiya I-${hit.number} davom etmoqda: «${hit.name}» sanalguncha harakat qilinmaydi`, { count_number: hit.number });
}

/** B16: a doctor asks for a patient's materials only for a recent visit (older visits are closed for the warehouse). */
export const REQUEST_VISIT_DAYS = 7;

export interface Purpose {
  purpose: 'patient' | 'procedure' | 'department';
  department: string;
  patientId: string | null;
  encounterId: string | null;
  orderId: string | null;
  icdCodes: string[];
  patientName?: string;
}

/**
 * Resolves what the items are for. A patient purpose names a visit of this branch; a procedure purpose names a
 * procedure order of a patient — both only by the treating doctor, for a visit of the last REQUEST_VISIT_DAYS days. The
 * ICD-10 codes come from the visit's note (codes only, never note text); only when the note has none yet are the
 * doctor's given codes used — every one must exist in icd10_codes.
 */
export async function resolvePurpose(c: Q, ctx: Ctx, branchId: string, input: { purpose: string; department: string; encounter_id?: string | null; order_id?: string | null; icd_codes: string[] }): Promise<Purpose> {
  const p: Purpose = { purpose: input.purpose as Purpose['purpose'], department: input.department, patientId: null, encounterId: null, orderId: null, icdCodes: [] };
  if (p.purpose === 'department') {
    if (input.encounter_id || input.order_id) throw invalid({ purpose: 'Bo‘lim uchun so‘rovda bemor ko‘rsatilmaydi' });
    return p;
  }
  if (ctx.role === 'lab') throw forbidden('Laboratoriya faqat bo‘lim uchun so‘raydi');
  // B4: a patient's materials are asked for by the treating doctor (codes from the visit), never typed in by the warehouse
  if (ctx.role !== 'doctor') throw forbidden('Bemor uchun materialni davolovchi shifokor so‘raydi');
  const oldest = dayStart(addDays(today(), -REQUEST_VISIT_DAYS));
  let encounterId: string | null = null;
  if (p.purpose === 'procedure') {
    if (!input.order_id) throw invalid({ order_id: 'Muolaja buyurtmasini tanlang' });
    const o = (await c.query(
      `SELECT o.id, o.patient_id, o.encounter_id, o.branch_id, o.category, o.status, o.doctor_id, o.performer_doctor_id, o.ordered_at FROM service_orders o WHERE o.id = $1 AND o.tenant_id = $2`,
      [input.order_id, ctx.tenantId])).rows[0];
    if (!o) throw notFound('Buyurtma');
    if (o.category !== 'procedure') throw invalid({ order_id: 'Bu muolaja buyurtmasi emas' });
    if (o.status === 'cancelled') throw invalid({ order_id: 'Buyurtma bekor qilingan' });
    if (o.branch_id !== branchId) throw invalid({ order_id: 'Buyurtma boshqa filialda' });
    if (o.doctor_id !== ctx.doctorId && o.performer_doctor_id !== ctx.doctorId) throw forbidden('Bu buyurtma sizniki emas');
    if (!o.encounter_id && new Date(o.ordered_at) < oldest) throw invalid({ order_id: `Buyurtma ${REQUEST_VISIT_DAYS} kundan eski — material so‘rab bo‘lmaydi` });
    p.orderId = o.id; p.patientId = o.patient_id; encounterId = o.encounter_id;
    if (input.encounter_id && input.encounter_id !== o.encounter_id) throw invalid({ encounter_id: 'Buyurtma boshqa qabulga tegishli' });
  } else {
    if (!input.encounter_id) throw invalid({ encounter_id: 'Qabulni tanlang' });
    if (input.order_id) throw invalid({ order_id: 'Muolaja uchun «Muolaja / operatsiya» maqsadini tanlang' });
    encounterId = input.encounter_id;
  }
  if (encounterId) {
    const e = (await c.query(`SELECT id, patient_id, branch_id, doctor_id, started_at FROM encounters WHERE id = $1 AND tenant_id = $2`, [encounterId, ctx.tenantId])).rows[0];
    if (!e) throw notFound('Qabul yozuvi');
    if (e.branch_id !== branchId) throw invalid({ encounter_id: 'Qabul boshqa filialda' });
    if (e.doctor_id !== ctx.doctorId && p.purpose === 'patient') throw forbidden('Bu qabul sizniki emas');
    if (new Date(e.started_at) < oldest) throw invalid({ encounter_id: `Qabul ${REQUEST_VISIT_DAYS} kundan eski — material so‘rab bo‘lmaydi` });
    if (p.patientId && p.patientId !== e.patient_id) throw invalid({ order_id: 'Buyurtma boshqa qabulga tegishli' });
    p.encounterId = e.id; p.patientId = e.patient_id;
    // codes only — the note text is never read here
    p.icdCodes = (await c.query(`SELECT coalesce(array_agg(x->>'code' ORDER BY o), '{}') AS codes FROM clinical_notes n, jsonb_array_elements(n.icd10) WITH ORDINALITY AS t(x, o) WHERE n.encounter_id = $1`, [e.id])).rows[0]?.codes ?? [];
  }
  if (!p.icdCodes.length) {
    const given = [...new Set(input.icd_codes)];
    if (!given.length) throw invalid({ icd_codes: 'Bemor uchun MKB-10 kodini kiriting' });
    const known = (await c.query(`SELECT code FROM icd10_codes WHERE code = ANY($1::text[])`, [given])).rows.map((r) => r.code);
    if (known.length !== given.length) throw invalid({ icd_codes: 'MKB-10 kodi ro‘yxatda topilmadi' });
    p.icdCodes = given;
  }
  const pt = (await c.query(`SELECT last_name, first_name FROM patients WHERE id = $1`, [p.patientId])).rows[0];
  p.patientName = pt ? `${pt.last_name} ${pt.first_name}` : '';
  return p;
}

export interface MoveRow {
  tenantId: string; itemId: string; branchId: string; batchId: string; type: 'in' | 'out';
  kind: 'receipt' | 'issue' | 'return' | 'writeoff' | 'adjust' | 'void';
  qtyC: number; unitCost: number | string; reason: string; actor: Ctx; at?: Date; docNo: string;
  receiver?: { id: string; name: string } | null; purpose?: Purpose | null;
  requestId?: string | null; receiptId?: string | null; writeoffId?: string | null; countId?: string | null; returnOf?: string | null; voidOf?: string | null;
  secondSigner?: { id: string; name: string } | null;
}
export async function insertMove(c: Q, m: MoveRow): Promise<string> {
  const p = m.purpose;
  return (await c.query(
    `INSERT INTO inventory_movements (id, tenant_id, item_id, type, quantity, reason, actor_name, occurred_at, kind, batch_id, branch_id, actor_membership_id,
       receiver_membership_id, receiver_name, purpose, patient_id, encounter_id, order_id, icd_codes, department, request_id, receipt_id, writeoff_id, count_id,
       return_of, void_of, unit_cost, value, doc_no, second_signer_membership_id, second_signer_name)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) RETURNING id`,
    [m.tenantId, m.itemId, m.type, fromC(m.qtyC), m.reason, m.actor.name, m.at ?? now(), m.kind, m.batchId, m.branchId, m.actor.membershipId || null,
      m.receiver?.id ?? null, m.receiver?.name ?? null, p?.purpose ?? null, p?.patientId ?? null, p?.encounterId ?? null, p?.orderId ?? null, p?.icdCodes ?? [], p?.department ?? null,
      m.requestId ?? null, m.receiptId ?? null, m.writeoffId ?? null, m.countId ?? null, m.returnOf ?? null, m.voidOf ?? null,
      String(m.unitCost), valueOf(m.qtyC, m.unitCost), m.docNo, m.secondSigner?.id ?? null, m.secondSigner?.name ?? null])).rows[0].id;
}

/**
 * Takes `qtyC` hundredths of an (already locked) item from its batches, earliest expiry first (FEFO). An expired batch
 * is never touched. Not enough usable stock → 409 INSUFFICIENT_STOCK (nothing is changed: the caller's tx rolls back).
 */
export async function takeFefo(c: Q, item: { id: string; name: string; unit: string }, qtyC: number) {
  const batches = (await c.query(
    `SELECT id, qty, unit_cost, batch_no, expiry_date FROM inventory_batches
      WHERE item_id = $1 AND qty > 0 AND (expiry_date IS NULL OR expiry_date >= $2::date)
      ORDER BY expiry_date NULLS LAST, received_at, id`, [item.id, today()])).rows;
  const usable = batches.reduce((s, b) => s + toC(b.qty), 0);
  if (usable < qtyC) throw conflict('INSUFFICIENT_STOCK', `Omborda yetarli emas: «${item.name}» — bor ${fromC(usable)} ${item.unit}`, { item_id: item.id, available: usable / 100 });
  const parts: { batchId: string; qtyC: number; unitCost: string; batchNo: string | null }[] = [];
  let left = qtyC;
  for (const b of batches) {
    if (left <= 0) break;
    const take = Math.min(left, toC(b.qty));
    await c.query(`UPDATE inventory_batches SET qty = qty - $2 WHERE id = $1`, [b.id, fromC(take)]);
    parts.push({ batchId: b.id, qtyC: take, unitCost: b.unit_cost, batchNo: b.batch_no });
    left -= take;
  }
  return parts;
}

/** Adds to a batch (return, positive count difference, void of an issue). */
export async function putBack(c: Q, batchId: string, qtyC: number) {
  await c.query(`UPDATE inventory_batches SET qty = qty + $2 WHERE id = $1`, [batchId, fromC(qtyC)]);
}
/** Takes from one named batch (write-off, negative count difference, void of a receipt): never below zero. */
export async function takeBatch(c: Q, batchId: string, qtyC: number, label: string) {
  const b = (await c.query(`SELECT qty FROM inventory_batches WHERE id = $1`, [batchId])).rows[0];
  if (toC(b.qty) < qtyC) throw conflict('INSUFFICIENT_STOCK', `Partiyada yetarli emas: ${label} — bor ${b.qty}`);
  await c.query(`UPDATE inventory_batches SET qty = qty - $2 WHERE id = $1`, [batchId, fromC(qtyC)]);
}

/** A person who takes items: an active staff member of this tenant with access to the branch. */
export async function loadReceiver(c: Q, ctx: Ctx, membershipId: string, branchId: string) {
  const r = (await c.query(
    `SELECT m.id, u.full_name AS name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.id = $1 AND m.tenant_id = $2 AND m.status = 'active' AND $3 = ANY(m.branch_ids)`, [membershipId, ctx.tenantId, branchId])).rows[0];
  if (!r) throw invalid({ receiver_membership_id: 'Xodimni tanlang' });
  return r as { id: string; name: string };
}
