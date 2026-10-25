import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  COLD_DEVICE_RANGE, translate, whColdDevicePatchSchema, whColdDeviceSchema, whCountDecisionSchema, whCountLinesSchema, whCountStartSchema, whDecisionSchema,
  whDirectIssueSchema, whFridgeSchema, whIssueSchema, whReceiptSchema, whRejectSchema, whRequestSchema, whReturnSchema, whVoidSchema, whWriteoffSchema,
  type MessageKey,
} from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, forbidden, invalid, notFound, staleState } from '../core/errors';
import { isDate, isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, now, today } from '../core/clock';
import { assertBranch, branchScope } from '../core/scope';
import { assertCsvRows, csvDate, csvMaxRows, csvPeriod, csvSom, csvTime, periodFits, sendCsv } from '../core/csv';
import {
  assertNotCounting, COUNTING_SQL, DOC_PREFIX, maskCounting, fromC, insertMove, loadReceiver, lockItems, nextNumber, Purpose, putBack, REQUEST_VISIT_DAYS, resolvePurpose, STOCK_SQL, takeBatch, takeFefo,
  toC, USABLE_SQL,
} from './warehouse';

const KEEPERS = ['storekeeper', 'manager'] as const;
const REQUESTERS = ['doctor', 'lab', 'manager'] as const;
const isKeeper = (ctx: Ctx) => ctx.role === 'storekeeper' || ctx.role === 'manager';
const needKey = (key: string | undefined) => { if (!key || key.length < 8 || key.length > 100) throw new AppError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key sarlavhasi majburiy'); };
/** Groups of the consumption report: by patient or diagnosis is the manager's (B8); the storekeeper sees items and departments. */
const KEEPER_GROUPS = ['item', 'department'];

/** A period from ?from&to (local days), at most a year (the shared export rule); default the last 30 days. */
function period(q: any) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : addDays(to, -29);
  if (!periodFits(from, to)) throw invalid({ from: 'Davr 1 yildan oshmasin' });
  return { from, to, start: dayStart(from), end: dayStart(addDays(to, 1)) };
}

const REQUEST_COLS = `r.id, r.number, r.branch_id, b.name AS branch_name, r.requester_membership_id, r.requester_name, r.requester_role, r.department, r.purpose,
  r.patient_id, r.encounter_id, r.order_id, r.icd_codes, r.note, r.direct, r.status, r.needs_approval, r.approved_by, r.approved_by_name, r.approved_at, r.created_at, r.submitted_at,
  r.closed_at, r.closed_by_name, r.reject_reason, p.last_name, p.first_name, p.patient_number, so.service_name AS order_service`;
const REQUEST_FROM = `inventory_requests r JOIN branches b ON b.id = r.branch_id LEFT JOIN patients p ON p.id = r.patient_id LEFT JOIN service_orders so ON so.id = r.order_id`;

@Controller('warehouse')
export class WarehouseController {
  constructor(private db: Db) {}

  // ------------------------------------------------------------------ overview
  @Roles(...KEEPERS) @Get('summary')
  async summary(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const br = branchScope(ctx, q.branch_id);
    const d = today();
    const r = (await this.db.one(
      `SELECT (SELECT count(*)::int FROM inventory_items i WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.active) AS items,
              (SELECT count(*)::int FROM inventory_items i WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.active AND ${USABLE_SQL()} < i.minimum_qty) AS low,
              (SELECT coalesce(sum(round(b.qty * b.unit_cost)),0)::bigint FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND b.qty > 0) AS value,
              (SELECT count(*)::int FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id WHERE b.tenant_id = $1 AND i.branch_id = ANY($2) AND b.qty > 0 AND b.expiry_date < $3::date) AS expired,
              (SELECT count(*)::int FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id WHERE b.tenant_id = $1 AND i.branch_id = ANY($2) AND b.qty > 0 AND b.expiry_date >= $3::date AND b.expiry_date <= $3::date + 90) AS expiring,
              (SELECT count(*)::int FROM inventory_requests r WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND r.status IN ('submitted','partially_issued')) AS requests,
              (SELECT count(*)::int FROM inventory_writeoffs w WHERE w.tenant_id = $1 AND w.branch_id = ANY($2) AND w.status = 'pending') AS writeoffs,
              (SELECT count(*)::int FROM fridge_temperature_log f WHERE f.tenant_id = $1 AND f.branch_id = ANY($2) AND f.out_of_range AND f.recorded_at >= $4) AS fridge_alerts,
              (SELECT max(c.decided_at) FROM inventory_counts c WHERE c.tenant_id = $1 AND c.branch_id = ANY($2) AND c.status = 'approved') AS last_count,
              EXISTS (SELECT 1 FROM inventory_items i WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.controlled) AS has_controlled`,
      [ctx.tenantId, br, d, dayStart(addDays(d, -6))]))!;
    return { data: { ...r, value: Number(r.value) } };
  }

  /** Stock on hand by item: balance, usable (not expired) balance, value, nearest expiry. */
  @Roles(...KEEPERS) @Get('stock')
  async stock(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id)];
    const where = ['i.tenant_id = $1', 'i.branch_id = ANY($2)'];
    if (q.category && ['medicine', 'consumable', 'reagent', 'instrument', 'other'].includes(q.category)) { params.push(q.category); where.push(`i.category = $${params.length}`); }
    if (q.controlled === '1') where.push('i.controlled');
    if (typeof q.q === 'string' && q.q.trim()) { params.push(`%${q.q.trim().toLowerCase().replace(/[%_\\]/g, '\\$&')}%`); where.push(`lower(i.name) LIKE $${params.length}`); }
    const rows = await this.db.rows(
      `SELECT * FROM (SELECT i.id, i.name, i.unit, i.category, i.storage, i.controlled, i.minimum_qty, i.active, i.branch_id, br.name AS branch_name, i.purchase_price, i.drug_id,
              ${STOCK_SQL()} AS qty, ${USABLE_SQL()} AS usable_qty, ${COUNTING_SQL()} AS counting,
              (SELECT coalesce(sum(round(b.qty * b.unit_cost)),0)::bigint FROM inventory_batches b WHERE b.item_id = i.id) AS value,
              (SELECT min(b.expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.qty > 0) AS next_expiry,
              (SELECT count(*)::int FROM inventory_batches b WHERE b.item_id = i.id AND b.qty > 0) AS batches
         FROM inventory_items i JOIN branches br ON br.id = i.branch_id WHERE ${where.join(' AND ')}) x
        WHERE ($${params.length + 1}::boolean IS NOT TRUE OR (active AND usable_qty < minimum_qty))
        ORDER BY active DESC, (usable_qty < minimum_qty) DESC, name LIMIT 1000`, [...params, q.low === '1']);
    return { data: maskCounting(ctx, rows.map((r) => ({ ...r, value: Number(r.value) })), ['qty', 'usable_qty', 'value', 'batches']) };
  }

  /** What a requester can pick: active items of the branch and how much is usable now. */
  @Roles('storekeeper', 'manager', 'doctor', 'lab') @Get('catalog')
  async catalog(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    if (!isUuid(q.branch_id)) throw invalid({ branch_id: 'Filialni tanlang' });
    assertBranch(ctx, q.branch_id);
    const rows = await this.db.rows(
      `SELECT i.id, i.name, i.unit, i.category, i.controlled, ${USABLE_SQL()} AS available, ${COUNTING_SQL()} AS counting FROM inventory_items i
        WHERE i.tenant_id = $1 AND i.branch_id = $2 AND i.active ${ctx.role === 'lab' ? `AND i.category IN ('reagent','consumable','other')` : ''} ORDER BY i.name LIMIT 1000`,
      [ctx.tenantId, q.branch_id]);
    return { data: maskCounting(ctx, rows, ['available']) };
  }

  /** Staff of a branch who may take items (the «oldi» person of a direct issue). */
  @Roles(...KEEPERS) @Get('staff')
  async staff(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const br = branchScope(ctx, q.branch_id);
    const rows = await this.db.rows(
      `SELECT m.id, u.full_name AS name, m.role, d.specialty FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN doctors d ON d.membership_id = m.id
        WHERE m.tenant_id = $1 AND m.status = 'active' AND m.branch_ids && $2::uuid[] AND m.role IN ('doctor','lab','manager','storekeeper','registrar')
        ORDER BY array_position(ARRAY['doctor','lab','manager','storekeeper','registrar'], m.role), u.full_name LIMIT 500`, [ctx.tenantId, br]);
    return { data: rows };
  }

  /**
   * The doctor's own recent visits of a branch (the last REQUEST_VISIT_DAYS days) to ask for a patient's materials from
   * «Talabnomalarim»: patient, ICD-10 codes, procedure orders — never note text. Nobody else gets a visit list (B8).
   */
  @Roles('doctor') @Get('visits')
  async visits(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    if (!isUuid(q.branch_id)) throw invalid({ branch_id: 'Filialni tanlang' });
    assertBranch(ctx, q.branch_id);
    const params: unknown[] = [ctx.tenantId, q.branch_id, dayStart(addDays(today(), -REQUEST_VISIT_DAYS)), ctx.doctorId];
    let filter = '';
    if (typeof q.q === 'string' && q.q.trim()) {
      const t = q.q.trim();
      if (/^\d+$/.test(t)) { params.push(Number(t)); filter = `AND p.patient_number = $${params.length}`; }
      else { params.push(t.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%'); filter = `AND lower(p.last_name) LIKE $${params.length}`; }
    }
    const rows = await this.db.rows(
      `SELECT e.id AS encounter_id, e.started_at, p.id AS patient_id, p.last_name, p.first_name, p.patient_number, d.display_name AS doctor_name, d.membership_id AS doctor_membership_id,
              coalesce((SELECT array_agg(x->>'code') FROM jsonb_array_elements(n.icd10) x), '{}') AS icd_codes,
              coalesce((SELECT json_agg(json_build_object('id', o.id, 'service_name', o.service_name)) FROM service_orders o WHERE o.encounter_id = e.id AND o.category = 'procedure' AND o.status <> 'cancelled'), '[]') AS procedures
         FROM encounters e JOIN patients p ON p.id = e.patient_id JOIN doctors d ON d.id = e.doctor_id LEFT JOIN clinical_notes n ON n.encounter_id = e.id
        WHERE e.tenant_id = $1 AND e.branch_id = $2 AND e.started_at >= $3 AND e.doctor_id = $4 ${filter} ORDER BY e.started_at DESC LIMIT 50`, params);
    return { data: rows };
  }

  /**
   * The doctor's page: what this visit needs to prefill a request (codes, procedure orders) and what was issued for it.
   * The treating doctor only (or the manager — never the storekeeper, B8). Never note text.
   */
  @Roles('doctor', 'manager') @Get('encounters/:id')
  async encounter(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Qabul yozuvi');
    const e = await this.db.one(`SELECT e.id, e.branch_id, e.patient_id, e.doctor_id FROM encounters e WHERE e.id = $1 AND e.tenant_id = $2 AND e.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!e) throw notFound('Qabul yozuvi');
    if (ctx.role === 'doctor' && e.doctor_id !== ctx.doctorId) throw forbidden('Bu qabul sizniki emas');
    const icd = (await this.db.one(`SELECT coalesce((SELECT array_agg(x->>'code') FROM clinical_notes n, jsonb_array_elements(n.icd10) x WHERE n.encounter_id = $1), '{}') AS codes`, [id]))!.codes;
    const procedures = await this.db.rows(`SELECT id, service_name, status FROM service_orders WHERE encounter_id = $1 AND category = 'procedure' AND status <> 'cancelled' ORDER BY ordered_at`, [id]);
    const requests = await this.db.rows(`SELECT ${REQUEST_COLS} FROM ${REQUEST_FROM} WHERE r.encounter_id = $1 AND r.tenant_id = $2 ORDER BY r.created_at DESC LIMIT 50`, [id, ctx.tenantId]);
    await this.attachLines(requests);
    // issued minus returned, per item and order (voided rows left out)
    const materials = await this.db.rows(
      `SELECT m.item_id, i.name, i.unit, m.order_id, sum(CASE WHEN m.kind = 'issue' THEN m.quantity ELSE -m.quantity END) AS qty
         FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
        WHERE m.encounter_id = $1 AND m.tenant_id = $2 AND m.kind IN ('issue','return') AND m.voided_at IS NULL
        GROUP BY 1,2,3,4 HAVING sum(CASE WHEN m.kind = 'issue' THEN m.quantity ELSE -m.quantity END) > 0 ORDER BY i.name LIMIT 200`, [id, ctx.tenantId]);
    return { data: { encounter_id: e.id, branch_id: e.branch_id, icd_codes: icd, procedures, requests, materials } };
  }

  // ------------------------------------------------------------------ receipts (kirim)
  @Roles(...KEEPERS) @Get('receipts')
  async receipts(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const br = branchScope(ctx, q.branch_id);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM inventory_receipts WHERE tenant_id = $1 AND branch_id = ANY($2)`, [ctx.tenantId, br]))!.n;
    const rows = await this.db.rows(
      `SELECT r.id, r.number, r.supplier, r.invoice_no, r.invoice_date, r.total, r.received_by_name, r.received_at, b.name AS branch_name,
              (SELECT count(*)::int FROM inventory_batches x WHERE x.receipt_id = r.id) AS lines,
              (SELECT count(*)::int FROM inventory_movements m WHERE m.receipt_id = r.id AND m.kind = 'receipt' AND m.voided_at IS NOT NULL) AS voided_lines
         FROM inventory_receipts r JOIN branches b ON b.id = r.branch_id WHERE r.tenant_id = $1 AND r.branch_id = ANY($2)
        ORDER BY r.received_at DESC, r.number DESC LIMIT $3 OFFSET $4`, [ctx.tenantId, br, pageSize, offset]);
    return { data: rows.map((r) => ({ ...r, total: Number(r.total) })), meta: { page, page_size: pageSize, total } };
  }

  @Roles(...KEEPERS) @Get('receipts/:id')
  async receipt(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Kirim hujjati');
    const r = await this.db.one(`SELECT r.*, b.name AS branch_name FROM inventory_receipts r JOIN branches b ON b.id = r.branch_id WHERE r.id = $1 AND r.tenant_id = $2 AND r.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!r) throw notFound('Kirim hujjati');
    // a voided line stays on the document, marked (B21): the total counts only the lines still in force
    const lines = await this.db.rows(
      `SELECT x.id, x.item_id, i.name, i.unit, x.batch_no, x.expiry_date, x.received_qty AS qty, x.unit_cost, round(x.received_qty * x.unit_cost)::bigint AS sum,
              m.voided_at, m.void_reason, m.voided_by_name
         FROM inventory_batches x JOIN inventory_items i ON i.id = x.item_id
         LEFT JOIN inventory_movements m ON m.batch_id = x.id AND m.receipt_id = x.receipt_id AND m.kind = 'receipt'
        WHERE x.receipt_id = $1 ORDER BY i.name`, [id]);
    const { idempotency_key: _k, ...doc } = r; void _k;
    return { data: { ...doc, total: Number(r.total), voided_lines: lines.filter((l) => l.voided_at).length, lines: lines.map((l) => ({ ...l, unit_cost: Number(l.unit_cost), sum: Number(l.sum) })) } };
  }

  /**
   * A supplier delivery. Idempotency-Key (B10): a retried «save» returns the first document instead of a second
   * receipt; the same supplier invoice (supplier + number + date) entered twice is refused (409 DUPLICATE_RECEIPT).
   */
  @Roles(...KEEPERS) @Post('receipts')
  async createReceipt(@CurrentCtx() ctx: Ctx, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    needKey(key);
    const input = parse(whReceiptSchema, body);
    assertBranch(ctx, input.branch_id);
    if (input.invoice_date > today()) throw invalid({ invoice_date: 'Kelajak sanasi mumkin emas' });
    input.lines.forEach((l, i) => { if (l.expiry_date && l.expiry_date < today()) throw invalid({ [`lines.${i}.expiry_date`]: 'Muddati o‘tgan partiya qabul qilinmaydi' }); });
    return this.db.tx(async (c) => {
      // one save at a time per key and per supplier invoice: the checks below cannot both pass in two parallel requests
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('wh_receipt:' || $1 || ':' || $2))`, [ctx.tenantId, key]);
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('wh_invoice:' || $1 || ':' || lower(btrim($2)) || ':' || lower(btrim($3))))`, [ctx.tenantId, input.supplier, input.invoice_no]);
      const prev = (await c.query(`SELECT id, number, branch_id, invoice_no FROM inventory_receipts WHERE tenant_id = $1 AND idempotency_key = $2`, [ctx.tenantId, key])).rows[0];
      if (prev) {
        if (prev.branch_id !== input.branch_id || prev.invoice_no !== input.invoice_no) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'Bu kalit boshqa amal uchun ishlatilgan');
        res.status(200);
        return { data: { id: prev.id, number: prev.number, replayed: true } };
      }
      const dup = (await c.query(
        `SELECT number FROM inventory_receipts WHERE tenant_id = $1 AND lower(btrim(supplier)) = lower(btrim($2)) AND lower(btrim(invoice_no)) = lower(btrim($3)) AND invoice_date = $4 LIMIT 1`,
        [ctx.tenantId, input.supplier, input.invoice_no, input.invoice_date])).rows[0];
      if (dup) throw conflict('DUPLICATE_RECEIPT', `Bu nakladnaya allaqachon kiritilgan: K-${dup.number}`, { number: dup.number });
      const items = await lockItems(c, ctx, input.branch_id, input.lines.map((l) => l.item_id));
      await assertNotCounting(c, ctx.tenantId, input.lines.map((l) => l.item_id));
      const number = await nextNumber(c, ctx.tenantId, 'receipt');
      const id = (await c.query(`SELECT gen_random_uuid() AS id`)).rows[0].id as string;
      const at = now();
      let total = 0n;
      for (const l of input.lines) total += (BigInt(toC(l.qty)) * BigInt(l.unit_cost) + 50n) / 100n;
      await c.query(`INSERT INTO inventory_receipts (id, tenant_id, branch_id, number, supplier, invoice_no, invoice_date, note, total, received_by, received_by_name, received_at, idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, ctx.tenantId, input.branch_id, number, input.supplier, input.invoice_no, input.invoice_date, input.note, total.toString(), ctx.membershipId, ctx.name, at, key]);
      const docNo = `${DOC_PREFIX.receipt}-${number}`;
      for (const l of input.lines) {
        const it = items.get(l.item_id)!;
        const batchId = (await c.query(
          `INSERT INTO inventory_batches (id, tenant_id, item_id, batch_no, expiry_date, qty, received_qty, unit_cost, supplier, invoice_no, receipt_id, received_at)
           VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [ctx.tenantId, l.item_id, l.batch_no, l.expiry_date ?? null, fromC(toC(l.qty)), l.unit_cost, input.supplier, input.invoice_no, id, at])).rows[0].id;
        await insertMove(c, { tenantId: ctx.tenantId, itemId: l.item_id, branchId: input.branch_id, batchId, type: 'in', kind: 'receipt', qtyC: toC(l.qty), unitCost: l.unit_cost,
          reason: `Kirim ${docNo}: ${input.supplier}, nakladnaya ${input.invoice_no}`, actor: ctx, at, docNo, receiptId: id });
        if (l.unit_cost > 0) await c.query(`UPDATE inventory_items SET purchase_price = $2 WHERE id = $1`, [it.id, l.unit_cost]);
      }
      await audit(c, ctx, 'warehouse.receipt', 'inventory_receipt', id, `Kirim ${docNo}: ${input.supplier}, ${input.lines.length} qator`, input.branch_id);
      res.status(201);
      return { data: { id, number, replayed: false } };
    });
  }

  // ------------------------------------------------------------------ requests (talabnoma)
  private async attachLines(requests: any[]) {
    if (!requests.length) return;
    const lines = await this.db.rows(
      `SELECT l.id, l.request_id, l.item_id, i.name, i.unit, i.controlled, l.qty, l.issued_qty FROM inventory_request_lines l JOIN inventory_items i ON i.id = l.item_id
        WHERE l.request_id = ANY($1::uuid[]) ORDER BY i.name`, [requests.map((r) => r.id)]);
    for (const r of requests) {
      r.lines = lines.filter((l) => l.request_id === r.id);
      // B5: one rule on both sides — the manager's signature is needed if the request had a controlled item when it was
      // written or has one now (an item put under control later does not strand the request)
      r.needs_approval = r.needs_approval || r.lines.some((l: any) => l.controlled);
    }
  }

  /** Needs the manager's signature: a controlled item when the request was written (snapshot) or now. */
  private async approvalNeeded(c: Q, r: any) {
    if (r.needs_approval) return true;
    return !!(await c.query(`SELECT 1 FROM inventory_request_lines l JOIN inventory_items i ON i.id = l.item_id WHERE l.request_id = $1 AND i.controlled LIMIT 1`, [r.id])).rowCount;
  }

  /** Storekeeper/manager: the queue of the branch. Doctor/lab: only their own requests. */
  @Roles('storekeeper', 'manager', 'doctor', 'lab') @Get('requests')
  async requests(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id)];
    const where = ['r.tenant_id = $1', 'r.branch_id = ANY($2)'];
    if (!isKeeper(ctx) || q.mine === '1') { params.push(ctx.membershipId); where.push(`r.requester_membership_id = $${params.length}`); }
    const STATUS: Record<string, string[]> = { open: ['submitted', 'partially_issued'], done: ['issued', 'rejected', 'cancelled'], draft: ['draft'] };
    if (STATUS[q.status]) { params.push(STATUS[q.status]); where.push(`r.status = ANY($${params.length})`); }
    // a storekeeper never sees somebody's unsent draft
    if (isKeeper(ctx) && q.mine !== '1') { params.push(ctx.membershipId); where.push(`(r.status <> 'draft' OR r.requester_membership_id = $${params.length})`); }
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM inventory_requests r WHERE ${where.join(' AND ')}`, params))!.n;
    const rows = await this.db.rows(`SELECT ${REQUEST_COLS} FROM ${REQUEST_FROM} WHERE ${where.join(' AND ')}
      ORDER BY (r.status IN ('submitted','partially_issued')) DESC, r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, offset]);
    await this.attachLines(rows);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  private async loadRequest(c: Q, ctx: Ctx, id: string, lock = false) {
    if (!isUuid(id)) throw notFound('Talabnoma');
    const r = (await c.query(`SELECT r.* FROM inventory_requests r WHERE r.id = $1 AND r.tenant_id = $2 AND r.branch_id = ANY($3) ${lock ? 'FOR UPDATE' : ''}`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
    if (!r) throw notFound('Talabnoma');
    if (!isKeeper(ctx) && r.requester_membership_id !== ctx.membershipId) throw notFound('Talabnoma');
    if (isKeeper(ctx) && r.status === 'draft' && r.requester_membership_id !== ctx.membershipId) throw notFound('Talabnoma');
    return r;
  }

  @Roles('storekeeper', 'manager', 'doctor', 'lab') @Get('requests/:id')
  async request(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await this.loadRequest(this.db.pool, ctx, id);
    const r = (await this.db.one(`SELECT ${REQUEST_COLS} FROM ${REQUEST_FROM} WHERE r.id = $1`, [id]))!;
    await this.attachLines([r]);
    r.movements = await this.db.rows(
      `SELECT m.id, m.kind, m.type, m.quantity, m.item_id, i.name, i.unit, b.batch_no, b.expiry_date, m.unit_cost, m.value, m.actor_name, m.receiver_name, m.second_signer_name,
              m.occurred_at, m.doc_no, m.voided_at, m.void_reason, m.return_of,
              (SELECT coalesce(sum(x.quantity),0) FROM inventory_movements x WHERE x.return_of = m.id AND x.voided_at IS NULL) AS returned
         FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id LEFT JOIN inventory_batches b ON b.id = m.batch_id
        WHERE m.request_id = $1 ORDER BY m.seq LIMIT 500`, [id]);
    if (!isKeeper(ctx)) r.movements.forEach((m: any) => { delete m.unit_cost; delete m.value; });
    else r.movements.forEach((m: any) => { m.unit_cost = Number(m.unit_cost); m.value = Number(m.value); });
    return { data: r };
  }

  private async insertRequest(c: Q, ctx: Ctx, input: { branch_id: string; department: string; note: string | null; lines: { item_id: string; qty: number }[] }, p: Purpose,
    requester: { id: string; name: string; role: string }, status: string, direct: boolean, items: Map<string, any>) {
    const number = await nextNumber(c, ctx.tenantId, 'request');
    const needsApproval = input.lines.some((l) => items.get(l.item_id)!.controlled);
    const at = now();
    const id = (await c.query(
      `INSERT INTO inventory_requests (id, tenant_id, branch_id, number, requester_membership_id, requester_name, requester_role, department, purpose, patient_id, encounter_id,
         order_id, icd_codes, note, direct, status, needs_approval, created_at, submitted_at)
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [ctx.tenantId, input.branch_id, number, requester.id, requester.name, requester.role, p.department, p.purpose, p.patientId, p.encounterId, p.orderId, p.icdCodes,
        input.note, direct, status, needsApproval, at, status === 'draft' ? null : at])).rows[0].id as string;
    for (const l of input.lines)
      await c.query(`INSERT INTO inventory_request_lines (id, tenant_id, request_id, item_id, qty) VALUES (gen_random_uuid(), $1,$2,$3,$4)`, [ctx.tenantId, id, l.item_id, fromC(toC(l.qty))]);
    return { id, number, needsApproval };
  }

  @Roles(...REQUESTERS) @Post('requests')
  async createRequest(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(whRequestSchema, body);
    assertBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      const items = await lockItems(c, ctx, input.branch_id, input.lines.map((l) => l.item_id));
      input.lines.forEach((l, i) => { if (!items.get(l.item_id)!.active) throw invalid({ [`lines.${i}.item_id`]: 'Material nofaol' }); });
      const p = await resolvePurpose(c, ctx, input.branch_id, input);
      const r = await this.insertRequest(c, ctx, input, p, { id: ctx.membershipId, name: ctx.name, role: ctx.role }, input.draft ? 'draft' : 'submitted', false, items);
      await audit(c, ctx, 'warehouse.request', 'inventory_request', r.id, `Talabnoma T-${r.number}: ${input.lines.length} qator, maqsad ${p.purpose}${input.draft ? ' (qoralama)' : ''}`, input.branch_id);
      return { data: { id: r.id, number: r.number, needs_approval: r.needsApproval } };
    });
  }

  @Roles(...REQUESTERS) @Post('requests/:id/submit') @HttpCode(200)
  async submit(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const r = await this.loadRequest(c, ctx, id, true);
      if (r.requester_membership_id !== ctx.membershipId) throw forbidden('Bu talabnoma sizniki emas');
      if (r.status !== 'draft') throw staleState();
      await c.query(`UPDATE inventory_requests SET status = 'submitted', submitted_at = $2 WHERE id = $1`, [id, now()]);
      await audit(c, ctx, 'warehouse.request_submit', 'inventory_request', id, `Talabnoma T-${r.number} yuborildi`, r.branch_id);
      return { data: { ok: true } };
    });
  }

  @Roles(...REQUESTERS) @Post('requests/:id/cancel') @HttpCode(200)
  async cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const r = await this.loadRequest(c, ctx, id, true);
      if (r.requester_membership_id !== ctx.membershipId) throw forbidden('Bu talabnoma sizniki emas');
      if (!['draft', 'submitted'].includes(r.status)) throw staleState();
      await c.query(`UPDATE inventory_requests SET status = 'cancelled', closed_at = $2, closed_by_name = $3 WHERE id = $1`, [id, now(), ctx.name]);
      await audit(c, ctx, 'warehouse.request_cancel', 'inventory_request', id, `Talabnoma T-${r.number} bekor qilindi`, r.branch_id);
      return { data: { ok: true } };
    });
  }

  /** Nothing issued yet → rejected; partly issued → the rest is closed (status «issued», reason kept). */
  @Roles(...KEEPERS) @Post('requests/:id/reject') @HttpCode(200)
  async reject(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(whRejectSchema, body);
    return this.db.tx(async (c) => {
      const r = await this.loadRequest(c, ctx, id, true);
      if (!['submitted', 'partially_issued'].includes(r.status)) throw staleState();
      const status = r.status === 'submitted' ? 'rejected' : 'issued';
      await c.query(`UPDATE inventory_requests SET status = $2, reject_reason = $3, closed_at = $4, closed_by_name = $5 WHERE id = $1`, [id, status, reason, now(), ctx.name]);
      await audit(c, ctx, 'warehouse.request_reject', 'inventory_request', id, `Talabnoma T-${r.number}: ${status === 'rejected' ? 'rad etildi' : 'qolgani yopildi'}`, r.branch_id);
      return { data: { ok: true, status } };
    });
  }

  /** Controlled items: the head (manager) signs the request first; the storekeeper's issue is the second signature. */
  @Roles('manager') @Post('requests/:id/approve') @HttpCode(200)
  async approve(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const r = await this.loadRequest(c, ctx, id, true);
      if (!(await this.approvalNeeded(c, r))) throw conflict('NO_APPROVAL_NEEDED', 'Bu talabnoma tasdiq talab qilmaydi');
      if (!['submitted', 'partially_issued'].includes(r.status) || r.approved_at) throw staleState();
      // two different people: whoever asked for a controlled drug cannot also approve it
      if (r.requester_membership_id === ctx.membershipId) throw conflict('SECOND_SIGNATURE', 'Ikkinchi imzo boshqa xodimdan bo‘lsin');
      await c.query(`UPDATE inventory_requests SET approved_by = $2, approved_by_name = $3, approved_at = $4, needs_approval = true WHERE id = $1`, [id, ctx.membershipId, ctx.name, now()]);
      await audit(c, ctx, 'warehouse.request_approve', 'inventory_request', id, `Talabnoma T-${r.number} tasdiqlandi (nazoratdagi dori)`, r.branch_id);
      return { data: { ok: true } };
    });
  }

  @Roles(...KEEPERS) @Post('requests/:id/issue') @HttpCode(200)
  async issue(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(whIssueSchema, body);
    return this.db.tx(async (c) => {
      const r = await this.loadRequest(c, ctx, id, true);
      if (!['submitted', 'partially_issued'].includes(r.status)) throw staleState();
      const lines = (await c.query(`SELECT * FROM inventory_request_lines WHERE request_id = $1 ORDER BY item_id`, [id])).rows;
      const want = new Map<string, number>();
      if (input.lines) for (const l of input.lines) {
        const line = lines.find((x) => x.id === l.line_id);
        if (!line) throw invalid({ lines: 'Talabnoma qatori topilmadi' });
        want.set(line.id, toC(l.qty));
      } else for (const l of lines) want.set(l.id, toC(l.qty) - toC(l.issued_qty));
      const items = await lockItems(c, ctx, r.branch_id, lines.map((l) => l.item_id));
      await assertNotCounting(c, ctx.tenantId, lines.filter((l) => (want.get(l.id) ?? 0) > 0).map((l) => l.item_id));
      // B5: the same rule as approve (snapshot on the request OR a controlled item now)
      const controlled = r.needs_approval || lines.some((l) => items.get(l.item_id)!.controlled);
      let second: { id: string; name: string } | null = null;
      if (controlled) {
        if (!r.approved_at) throw conflict('APPROVAL_REQUIRED', 'Nazoratdagi dori: avval rahbar talabnomani tasdiqlasin');
        // B12: three different people — whoever asked and whoever signed never hands the controlled drug out
        if (r.approved_by === ctx.membershipId || r.requester_membership_id === ctx.membershipId) throw conflict('SECOND_SIGNATURE', 'Ikkinchi imzo boshqa xodimdan bo‘lsin');
        second = { id: r.approved_by, name: r.approved_by_name };
      }
      const p: Purpose = { purpose: r.purpose, department: r.department, patientId: r.patient_id, encounterId: r.encounter_id, orderId: r.order_id, icdCodes: r.icd_codes };
      const docNo = `${DOC_PREFIX.request}-${r.number}`;
      const receiver = { id: r.requester_membership_id, name: r.requester_name };
      let issued = 0;
      for (const l of lines) {
        const q = want.get(l.id) ?? 0;
        if (q <= 0) continue;
        if (q > toC(l.qty) - toC(l.issued_qty)) throw invalid({ lines: `«${items.get(l.item_id)!.name}»: so‘ralgandan ko‘p berib bo‘lmaydi` });
        const it = items.get(l.item_id)!;
        for (const part of await takeFefo(c, it, q))
          await insertMove(c, { tenantId: ctx.tenantId, itemId: it.id, branchId: r.branch_id, batchId: part.batchId, type: 'out', kind: 'issue', qtyC: part.qtyC, unitCost: part.unitCost,
            reason: `Talabnoma ${docNo}`, actor: ctx, docNo, receiver, purpose: p, requestId: id, secondSigner: second });
        await c.query(`UPDATE inventory_request_lines SET issued_qty = issued_qty + $2 WHERE id = $1`, [l.id, fromC(q)]);
        issued++;
      }
      if (!issued) throw invalid({ lines: 'Berish uchun miqdor kiriting' });
      const left = (await c.query(`SELECT count(*)::int AS n FROM inventory_request_lines WHERE request_id = $1 AND issued_qty < qty`, [id])).rows[0].n;
      const status = left ? 'partially_issued' : 'issued';
      await c.query(`UPDATE inventory_requests SET status = $2, closed_at = CASE WHEN $2 = 'issued' THEN $3::timestamptz END, closed_by_name = CASE WHEN $2 = 'issued' THEN $4 END WHERE id = $1`,
        [id, status, now(), ctx.name]);
      await audit(c, ctx, 'warehouse.issue', 'inventory_request', id, `Talabnoma ${docNo}: ${issued} qator berildi${status === 'partially_issued' ? ' (qisman)' : ''}`, r.branch_id);
      return { data: { ok: true, status } };
    });
  }

  /**
   * Emergency: the storekeeper issues at once to a department (a request row is the document). A patient's materials
   * come only from the treating doctor's request (B4 — codes from the visit, never typed by the warehouse), and the
   * person who takes the items is never the one who hands them out.
   */
  @Roles(...KEEPERS) @Post('issues')
  async directIssue(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(whDirectIssueSchema, body);
    assertBranch(ctx, input.branch_id);
    if (input.purpose !== 'department') throw invalid({ purpose: 'Bemor uchun material faqat shifokor talabnomasi orqali beriladi' });
    if (input.receiver_membership_id === ctx.membershipId) throw invalid({ receiver_membership_id: 'Materialni oluvchi va beruvchi boshqa-boshqa odam bo‘lsin' });
    return this.db.tx(async (c) => {
      const items = await lockItems(c, ctx, input.branch_id, input.lines.map((l) => l.item_id));
      if (input.lines.some((l) => items.get(l.item_id)!.controlled))
        throw conflict('CONTROLLED_TWO_SIGNATURES', 'Nazoratdagi dori faqat talabnoma orqali, rahbar tasdig‘i bilan beriladi');
      await assertNotCounting(c, ctx.tenantId, input.lines.map((l) => l.item_id));
      const receiver = await loadReceiver(c, ctx, input.receiver_membership_id, input.branch_id);
      const p = await resolvePurpose(c, ctx, input.branch_id, input);
      const r = await this.insertRequest(c, ctx, input, p, { id: receiver.id, name: receiver.name, role: 'direct' }, 'issued', true, items);
      const docNo = `${DOC_PREFIX.request}-${r.number}`;
      for (const l of input.lines) {
        const it = items.get(l.item_id)!;
        for (const part of await takeFefo(c, it, toC(l.qty)))
          await insertMove(c, { tenantId: ctx.tenantId, itemId: it.id, branchId: input.branch_id, batchId: part.batchId, type: 'out', kind: 'issue', qtyC: part.qtyC, unitCost: part.unitCost,
            reason: `To‘g‘ridan-to‘g‘ri berildi ${docNo}`, actor: ctx, docNo, receiver, purpose: p, requestId: r.id });
      }
      await c.query(`UPDATE inventory_request_lines SET issued_qty = qty WHERE request_id = $1`, [r.id]);
      await c.query(`UPDATE inventory_requests SET closed_at = $2, closed_by_name = $3 WHERE id = $1`, [r.id, now(), ctx.name]);
      await audit(c, ctx, 'warehouse.issue_direct', 'inventory_request', r.id, `${docNo}: ${input.lines.length} qator berildi, oldi: ${receiver.name}`, input.branch_id);
      return { data: { id: r.id, number: r.number } };
    });
  }

  // ------------------------------------------------------------------ ledger
  private movementFilter(ctx: Ctx, q: any) {
    const { start, end, from, to } = period(q);
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), start, end];
    const where = ['m.tenant_id = $1', 'm.branch_id = ANY($2)', 'm.occurred_at >= $3', 'm.occurred_at < $4'];
    if (['receipt', 'issue', 'return', 'writeoff', 'adjust', 'void', 'legacy'].includes(q.kind)) { params.push(q.kind); where.push(`m.kind = $${params.length}`); }
    if (isUuid(q.item_id)) { params.push(q.item_id); where.push(`m.item_id = $${params.length}`); }
    return { params, where, from, to };
  }
  private static MOVE_SELECT = `SELECT m.id, m.seq, m.kind, m.type, m.quantity, m.item_id, i.name AS item_name, i.unit, i.controlled, x.batch_no, x.expiry_date, m.unit_cost, m.value, m.reason,
      m.actor_name, m.receiver_name, m.second_signer_name, m.purpose, m.department, m.icd_codes, m.doc_no, m.occurred_at, m.voided_at, m.voided_by_name, m.void_reason, m.return_of, m.void_of,
      m.request_id, p.last_name, p.first_name, p.patient_number, so.service_name AS order_service, b.name AS branch_name
    FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id JOIN branches b ON b.id = m.branch_id LEFT JOIN inventory_batches x ON x.id = m.batch_id
    LEFT JOIN patients p ON p.id = m.patient_id LEFT JOIN service_orders so ON so.id = m.order_id`;

  @Roles(...KEEPERS) @Get('movements')
  async movements(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const { params, where } = this.movementFilter(ctx, q);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM inventory_movements m WHERE ${where.join(' AND ')}`, params))!.n;
    const rows = await this.db.rows(`${WarehouseController.MOVE_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.occurred_at DESC, m.seq DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]);
    return { data: rows.map((r) => ({ ...r, unit_cost: Number(r.unit_cost), value: Number(r.value) })), meta: { page, page_size: pageSize, total } };
  }

  @Roles(...KEEPERS) @Get('movements.csv')
  async movementsCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    csvPeriod(q); // a bounded period is required for an export
    const { params, where, from, to } = this.movementFilter(ctx, q);
    // B7: more rows than an export may hold is refused (narrow the period), never cut silently
    const rows = await this.db.rows(`${WarehouseController.MOVE_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.occurred_at, m.seq LIMIT ${csvMaxRows() + 1}`, params);
    assertCsvRows(rows.length);
    // quantities and sums are signed numbers (out = negative), so the totals row is the plain sum of the column;
    // a quantity total only makes sense for one item (units differ)
    const sign = (r: any) => (r.type === 'in' ? 1 : -1);
    let qtyC = 0, valueT = 0;
    for (const r of rows) { qtyC += sign(r) * toC(r.quantity); valueT += sign(r) * Number(r.value); }
    const oneItem = isUuid(q.item_id);
    sendCsv(res, `ombor-harakatlari-${from}-${to}.csv`,
      ['Sana', 'Hujjat', 'Turi', 'Material', 'Seriya', 'Yaroqlilik', 'Miqdor', 'Birlik', 'Narx (so‘m)', 'Summa (so‘m)', 'Kim berdi', 'Kim oldi', 'Ikkinchi imzo', 'Maqsad', 'Bo‘lim', 'Bemor ID', 'MKB-10', 'Muolaja', 'Filial', 'Sabab', 'Bekor qilingan'],
      [...rows.map((r) => [csvTime(r.occurred_at), r.doc_no ?? '', r.kind, r.item_name, r.batch_no ?? '', r.expiry_date ? csvDate(r.expiry_date) : '', fromC(sign(r) * toC(r.quantity)), r.unit,
        csvSom(r.unit_cost), csvSom(sign(r) * Number(r.value)), r.actor_name, r.receiver_name ?? '', r.second_signer_name ?? '', r.purpose ?? '', r.department ?? '', r.patient_number ?? '', (r.icd_codes ?? []).join(' '),
        r.order_service ?? '', r.branch_name, r.reason, r.voided_at ? `${csvTime(r.voided_at)} ${r.void_reason}` : '']),
      ['Jami', `${rows.length} ta harakat`, '', '', '', '', oneItem ? fromC(qtyC) : '', oneItem ? rows[0]?.unit ?? '' : '', '', csvSom(valueT), '', '', '', '', '', '', '', '', '', '', '']]);
  }

  /** Unused items back to the very batch they came from; the return keeps the issue's doctor, patient and purpose. */
  @Roles(...KEEPERS) @Post('movements/:id/return')
  async returnItems(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(whReturnSchema, body);
    if (!isUuid(id)) throw notFound('Harakat');
    return this.db.tx(async (c) => {
      const m0 = (await c.query(`SELECT m.item_id FROM inventory_movements m WHERE m.id = $1 AND m.tenant_id = $2 AND m.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!m0) throw notFound('Harakat');
      await c.query(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, [m0.item_id]);
      await assertNotCounting(c, ctx.tenantId, [m0.item_id]);
      const m = (await c.query(`SELECT * FROM inventory_movements WHERE id = $1`, [id])).rows[0];
      if (m.kind !== 'issue') throw invalid({ qty: 'Faqat berilgan materialni qaytarish mumkin' });
      if (m.voided_at) throw conflict('VOIDED', 'Bu yozuv bekor qilingan');
      const returned = (await c.query(`SELECT coalesce(sum(quantity),0) AS q FROM inventory_movements WHERE return_of = $1 AND voided_at IS NULL`, [id])).rows[0].q;
      const left = toC(m.quantity) - toC(returned);
      if (toC(input.qty) > left) throw invalid({ qty: `Qaytariladigan miqdor berilganidan ko‘p (qolgan: ${fromC(left)})` });
      await putBack(c, m.batch_id, toC(input.qty));
      const p: Purpose = { purpose: m.purpose, department: m.department, patientId: m.patient_id, encounterId: m.encounter_id, orderId: m.order_id, icdCodes: m.icd_codes };
      const newId = await insertMove(c, { tenantId: ctx.tenantId, itemId: m.item_id, branchId: m.branch_id, batchId: m.batch_id, type: 'in', kind: 'return', qtyC: toC(input.qty), unitCost: m.unit_cost,
        reason: `Qaytarildi: ${input.reason}`, actor: ctx, docNo: m.doc_no, receiver: { id: m.receiver_membership_id, name: m.receiver_name }, purpose: p, requestId: m.request_id, returnOf: id });
      await audit(c, ctx, 'warehouse.return', 'inventory_movement', newId, `${m.doc_no}: ${input.qty} qaytarildi omborga`, m.branch_id);
      return { data: { id: newId } };
    });
  }

  /** A wrong entry is voided once by the manager (reason kept) and its quantity reversed on the same batch. */
  @Roles('manager') @Post('movements/:id/void') @HttpCode(200)
  async voidMovement(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(whVoidSchema, body);
    if (!isUuid(id)) throw notFound('Harakat');
    return this.db.tx(async (c) => {
      const m0 = (await c.query(`SELECT m.item_id FROM inventory_movements m WHERE m.id = $1 AND m.tenant_id = $2 AND m.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!m0) throw notFound('Harakat');
      await c.query(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, [m0.item_id]);
      await assertNotCounting(c, ctx.tenantId, [m0.item_id]);
      const m = (await c.query(`SELECT * FROM inventory_movements WHERE id = $1`, [id])).rows[0];
      if (m.voided_at) throw staleState();
      if (!['receipt', 'issue', 'return'].includes(m.kind) || !m.batch_id) throw conflict('NOT_VOIDABLE', 'Bu yozuvni bekor qilib bo‘lmaydi (hujjat orqali tuzating)');
      if ((await c.query(`SELECT 1 FROM inventory_movements WHERE return_of = $1 AND voided_at IS NULL`, [id])).rowCount) throw conflict('HAS_RETURNS', 'Avval bu chiqimning qaytarishlarini bekor qiling');
      if (m.type === 'in') await takeBatch(c, m.batch_id, toC(m.quantity), m.doc_no ?? '');
      else await putBack(c, m.batch_id, toC(m.quantity));
      const p: Purpose | null = m.purpose ? { purpose: m.purpose, department: m.department, patientId: m.patient_id, encounterId: m.encounter_id, orderId: m.order_id, icdCodes: m.icd_codes } : null;
      await insertMove(c, { tenantId: ctx.tenantId, itemId: m.item_id, branchId: m.branch_id, batchId: m.batch_id, type: m.type === 'in' ? 'out' : 'in', kind: 'void', qtyC: toC(m.quantity), unitCost: m.unit_cost,
        reason: `Bekor qilindi: ${reason}`, actor: ctx, docNo: m.doc_no, purpose: p, requestId: m.request_id, voidOf: id });
      await c.query(`UPDATE inventory_movements SET voided_at = $2, voided_by_name = $3, void_reason = $4 WHERE id = $1`, [id, now(), ctx.name, reason]);
      if (m.request_id && m.kind === 'issue') {
        await c.query(`UPDATE inventory_request_lines SET issued_qty = GREATEST(issued_qty - $3, 0) WHERE request_id = $1 AND item_id = $2`, [m.request_id, m.item_id, m.quantity]);
        // B9: the request opens again for what is no longer issued (approved / partly issued), so it can be issued anew
        const r = (await c.query(`SELECT status FROM inventory_requests WHERE id = $1 FOR UPDATE`, [m.request_id])).rows[0];
        if (r && ['issued', 'partially_issued'].includes(r.status)) {
          const sum = (await c.query(`SELECT count(*) FILTER (WHERE issued_qty < qty)::int AS open, coalesce(sum(issued_qty), 0) AS issued FROM inventory_request_lines WHERE request_id = $1`, [m.request_id])).rows[0];
          const status = !sum.open ? 'issued' : Number(sum.issued) > 0 ? 'partially_issued' : 'submitted';
          if (status !== r.status) await c.query(`UPDATE inventory_requests SET status = $2, closed_at = NULL, closed_by_name = NULL, reject_reason = NULL WHERE id = $1`, [m.request_id, status]);
        }
      }
      // B21: the receipt document keeps the line (marked voided) and its total counts only the lines in force
      if (m.receipt_id && m.kind === 'receipt') await c.query(`UPDATE inventory_receipts SET total = total - $2 WHERE id = $1`, [m.receipt_id, m.value]);
      await audit(c, ctx, 'warehouse.void', 'inventory_movement', id, `${m.doc_no ?? ''}: yozuv bekor qilindi`, m.branch_id);
      return { data: { ok: true } };
    });
  }

  // ------------------------------------------------------------------ write-off acts (spisaniye)
  @Roles(...KEEPERS) @Get('writeoffs')
  async writeoffs(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const br = branchScope(ctx, q.branch_id);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM inventory_writeoffs WHERE tenant_id = $1 AND branch_id = ANY($2)`, [ctx.tenantId, br]))!.n;
    const rows = await this.db.rows(
      `SELECT w.id, w.number, w.reason, w.note, w.commission, w.status, w.controlled, w.created_by_name, w.created_at, w.decided_by_name, w.decided_at, w.total, b.name AS branch_name,
              (SELECT count(*)::int FROM inventory_writeoff_lines l WHERE l.writeoff_id = w.id) AS lines
         FROM inventory_writeoffs w JOIN branches b ON b.id = w.branch_id WHERE w.tenant_id = $1 AND w.branch_id = ANY($2)
        ORDER BY (w.status = 'pending') DESC, w.created_at DESC LIMIT $3 OFFSET $4`, [ctx.tenantId, br, pageSize, offset]);
    return { data: rows.map((r) => ({ ...r, total: Number(r.total) })), meta: { page, page_size: pageSize, total } };
  }

  @Roles(...KEEPERS) @Get('writeoffs/:id')
  async writeoff(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Hisobdan chiqarish akti');
    const w = await this.db.one(`SELECT w.*, b.name AS branch_name FROM inventory_writeoffs w JOIN branches b ON b.id = w.branch_id WHERE w.id = $1 AND w.tenant_id = $2 AND w.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!w) throw notFound('Hisobdan chiqarish akti');
    const lines = await this.db.rows(
      `SELECT l.id, l.batch_id, l.qty, x.batch_no, x.expiry_date, x.unit_cost, round(l.qty * x.unit_cost)::bigint AS sum, i.name, i.unit, i.controlled
         FROM inventory_writeoff_lines l JOIN inventory_batches x ON x.id = l.batch_id JOIN inventory_items i ON i.id = x.item_id WHERE l.writeoff_id = $1 ORDER BY i.name`, [id]);
    return { data: { ...w, total: Number(w.total), lines: lines.map((l) => ({ ...l, unit_cost: Number(l.unit_cost), sum: Number(l.sum) })) } };
  }

  @Roles(...KEEPERS) @Post('writeoffs')
  async createWriteoff(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(whWriteoffSchema, body);
    assertBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      const batches = (await c.query(
        `SELECT x.id, x.qty, x.unit_cost, x.expiry_date, i.branch_id, i.controlled, i.name FROM inventory_batches x JOIN inventory_items i ON i.id = x.item_id
          WHERE x.id = ANY($1::uuid[]) AND x.tenant_id = $2`, [input.lines.map((l) => l.batch_id), ctx.tenantId])).rows;
      let total = 0n;
      input.lines.forEach((l, i) => {
        const b = batches.find((x) => x.id === l.batch_id);
        if (!b || b.branch_id !== input.branch_id) throw invalid({ [`lines.${i}.batch_id`]: 'Partiya topilmadi' });
        if (toC(l.qty) > toC(b.qty)) throw invalid({ [`lines.${i}.qty`]: `Partiyada bor: ${b.qty}` });
        total += (BigInt(toC(l.qty)) * BigInt(b.unit_cost) + 50n) / 100n;
      });
      const number = await nextNumber(c, ctx.tenantId, 'writeoff');
      const controlled = batches.some((b) => b.controlled);
      const id = (await c.query(
        `INSERT INTO inventory_writeoffs (id, tenant_id, branch_id, number, reason, note, commission, status, controlled, created_by, created_by_name, created_at, total)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11) RETURNING id`,
        [ctx.tenantId, input.branch_id, number, input.reason, input.note, input.commission, controlled, ctx.membershipId, ctx.name, now(), total.toString()])).rows[0].id as string;
      for (const l of input.lines)
        await c.query(`INSERT INTO inventory_writeoff_lines (id, tenant_id, writeoff_id, batch_id, qty) VALUES (gen_random_uuid(), $1,$2,$3,$4)`, [ctx.tenantId, id, l.batch_id, fromC(toC(l.qty))]);
      await audit(c, ctx, 'warehouse.writeoff', 'inventory_writeoff', id, `Hisobdan chiqarish akti A-${number} tuzildi (${input.lines.length} qator)`, input.branch_id);
      return { data: { id, number } };
    });
  }

  /** The manager approves (stock leaves) or rejects. Whoever drew up the act never approves it (two signatures). */
  @Roles('manager') @Post('writeoffs/:id/decide') @HttpCode(200)
  async decideWriteoff(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(whDecisionSchema, body);
    if (!isUuid(id)) throw notFound('Hisobdan chiqarish akti');
    return this.db.tx(async (c) => {
      const w = (await c.query(`SELECT * FROM inventory_writeoffs WHERE id = $1 AND tenant_id = $2 AND branch_id = ANY($3) FOR UPDATE`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!w) throw notFound('Hisobdan chiqarish akti');
      if (w.status !== 'pending') throw staleState();
      if (w.created_by === ctx.membershipId) throw conflict('SECOND_SIGNATURE', 'Ikkinchi imzo boshqa xodimdan bo‘lsin');
      const docNo = `${DOC_PREFIX.writeoff}-${w.number}`;
      if (input.approve) {
        const lines = (await c.query(`SELECT l.*, x.item_id, x.unit_cost, x.batch_no FROM inventory_writeoff_lines l JOIN inventory_batches x ON x.id = l.batch_id WHERE l.writeoff_id = $1`, [id])).rows;
        await lockItems(c, ctx, w.branch_id, lines.map((l) => l.item_id));
        await assertNotCounting(c, ctx.tenantId, lines.map((l) => l.item_id));
        for (const l of lines) {
          await takeBatch(c, l.batch_id, toC(l.qty), l.batch_no ?? '');
          await insertMove(c, { tenantId: ctx.tenantId, itemId: l.item_id, branchId: w.branch_id, batchId: l.batch_id, type: 'out', kind: 'writeoff', qtyC: toC(l.qty), unitCost: l.unit_cost,
            reason: `Hisobdan chiqarildi ${docNo}: ${w.note}`, actor: ctx, docNo, writeoffId: id, secondSigner: { id: w.created_by, name: w.created_by_name } });
        }
      }
      await c.query(`UPDATE inventory_writeoffs SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = $5, decision_note = $6 WHERE id = $1`,
        [id, input.approve ? 'approved' : 'rejected', ctx.membershipId, ctx.name, now(), input.note]);
      await audit(c, ctx, input.approve ? 'warehouse.writeoff_approve' : 'warehouse.writeoff_reject', 'inventory_writeoff', id, `${docNo} ${input.approve ? 'tasdiqlandi' : 'rad etildi'}`, w.branch_id);
      return { data: { ok: true } };
    });
  }

  // ------------------------------------------------------------------ batches: expiring / expired
  @Roles(...KEEPERS) @Get('batches')
  async batches(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), today()];
    const where = ['x.tenant_id = $1', 'i.branch_id = ANY($2)', 'x.qty > 0'];
    if (q.expiring) {
      const days = Math.min(365, Math.max(1, Number.parseInt(q.expiring, 10) || 90));
      params.push(days); where.push(`x.expiry_date IS NOT NULL AND x.expiry_date <= $3::date + $${params.length}::int`);
    }
    if (isUuid(q.item_id)) { params.push(q.item_id); where.push(`x.item_id = $${params.length}`); }
    const rows = await this.db.rows(
      `SELECT x.id, x.item_id, i.name, i.unit, i.controlled, i.category, x.batch_no, x.expiry_date, x.qty, x.unit_cost, round(x.qty * x.unit_cost)::bigint AS value, x.supplier, x.received_at,
              (x.expiry_date < $3::date) AS expired, (x.expiry_date - $3::date) AS days_left, b.name AS branch_name, ${COUNTING_SQL()} AS counting
         FROM inventory_batches x JOIN inventory_items i ON i.id = x.item_id JOIN branches b ON b.id = i.branch_id
        WHERE ${where.join(' AND ')} ORDER BY x.expiry_date NULLS LAST, i.name LIMIT 1000`, params);
    return { data: maskCounting(ctx, rows.map((r) => ({ ...r, unit_cost: Number(r.unit_cost), value: Number(r.value) })), ['qty', 'value']) };
  }

  // ------------------------------------------------------------------ controlled-substance journal
  /** The register of one controlled item: every entry with the running balance, patient, doctor, document and both signatures. */
  @Roles(...KEEPERS) @Get('controlled/:itemId')
  async journal(@CurrentCtx() ctx: Ctx, @Param('itemId') itemId: string, @Query() q: any) {
    if (!isUuid(itemId)) throw notFound('Material');
    const item = await this.db.one(`SELECT i.id, i.name, i.unit, i.controlled, i.opening_qty, i.branch_id, b.name AS branch_name, ${STOCK_SQL()} AS qty FROM inventory_items i JOIN branches b ON b.id = i.branch_id
      WHERE i.id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3)`, [itemId, ctx.tenantId, ctx.branchIds]);
    if (!item) throw notFound('Material');
    if (!item.controlled) throw conflict('NOT_CONTROLLED', 'Bu material nazoratdagi ro‘yxatda emas');
    const { start, end, from, to } = period(q);
    // B18: the balance at the start and at the end of the chosen period (not today's stock): opening_qty + Σ ledger before
    const bal = (await this.db.one(
      `SELECT $4::numeric + coalesce(sum(CASE WHEN occurred_at < $2 THEN (CASE WHEN type = 'in' THEN quantity ELSE -quantity END) END), 0) AS opening,
              $4::numeric + coalesce(sum(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) AS closing,
              coalesce(sum(CASE WHEN occurred_at >= $2 AND type = 'in' THEN quantity END), 0) AS period_in,
              coalesce(sum(CASE WHEN occurred_at >= $2 AND type = 'out' THEN quantity END), 0) AS period_out
         FROM inventory_movements WHERE item_id = $1 AND occurred_at < $3`, [itemId, start, end, item.opening_qty]))!;
    const rows = await this.db.rows(
      `SELECT * FROM (SELECT m.id, m.seq, m.occurred_at, m.kind, m.type, m.quantity, m.doc_no, x.batch_no, x.expiry_date, m.actor_name, m.receiver_name, m.second_signer_name, m.purpose, m.department,
              m.icd_codes, m.reason, m.voided_at, m.void_reason, p.last_name, p.first_name, p.patient_number,
              $4::numeric + sum(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END) OVER (ORDER BY m.occurred_at, m.seq) AS balance
         FROM inventory_movements m LEFT JOIN inventory_batches x ON x.id = m.batch_id LEFT JOIN patients p ON p.id = m.patient_id
        WHERE m.item_id = $1 AND m.occurred_at < $3) t WHERE occurred_at >= $2 ORDER BY occurred_at, seq LIMIT 2000`, [itemId, start, end, item.opening_qty]);
    // a blind count of this item is open: only the manager reads its balances (the entries' running balance too)
    if (ctx.role !== 'manager' && (await this.db.one(`SELECT ${COUNTING_SQL()} AS counting FROM inventory_items i WHERE i.id = $1`, [itemId]))!.counting)
      return { data: { item: { ...item, qty: null }, from, to, opening_balance: null, closing_balance: null, period_in: bal.period_in, period_out: bal.period_out, counting: true,
        entries: rows.map((r: Record<string, unknown>) => ({ ...r, balance: null })) } };
    return { data: { item, from, to, opening_balance: bal.opening, closing_balance: bal.closing, period_in: bal.period_in, period_out: bal.period_out, entries: rows } };
  }

  // ------------------------------------------------------------------ inventory counts
  /**
   * B2 (blind count): the expected quantity and the differences are the manager's, and only after the count is handed in.
   * While a count is open nobody sees them; the storekeeper never does.
   */
  private static seesExpected = (ctx: Ctx, status: string) => ctx.role === 'manager' && status !== 'open';

  @Roles(...KEEPERS) @Get('counts')
  async counts(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const rows = await this.db.rows(
      `SELECT c.id, c.number, c.scope, c.status, c.started_by_name, c.started_at, c.decided_by_name, c.decided_at, b.name AS branch_name,
              (SELECT count(*)::int FROM inventory_count_lines l WHERE l.count_id = c.id) AS lines,
              (SELECT count(*)::int FROM inventory_count_lines l WHERE l.count_id = c.id AND l.counted_qty IS NOT NULL) AS counted,
              (SELECT count(*)::int FROM inventory_count_lines l WHERE l.count_id = c.id AND l.counted_qty IS NOT NULL AND l.counted_qty <> l.expected_qty) AS differences
         FROM inventory_counts c JOIN branches b ON b.id = c.branch_id WHERE c.tenant_id = $1 AND c.branch_id = ANY($2) ORDER BY c.started_at DESC LIMIT 100`,
      [ctx.tenantId, branchScope(ctx, q.branch_id)]);
    return { data: rows.map((r) => (WarehouseController.seesExpected(ctx, r.status) ? r : { ...r, differences: null })) };
  }

  /**
   * One count: the header, progress (counted of all lines) and one page of lines (B15: a large count is read and saved
   * in pages; `?all=1` gives every line for the printed sheet). Filters: `q` (item name), `only=uncounted|diff`.
   */
  @Roles(...KEEPERS) @Get('counts/:id')
  async count(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    if (!isUuid(id)) throw notFound('Inventarizatsiya');
    const c = await this.db.one(`SELECT c.*, b.name AS branch_name FROM inventory_counts c JOIN branches b ON b.id = c.branch_id WHERE c.id = $1 AND c.tenant_id = $2 AND c.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!c) throw notFound('Inventarizatsiya');
    const sees = WarehouseController.seesExpected(ctx, c.status);
    const params: unknown[] = [id];
    const where = ['l.count_id = $1'];
    if (typeof q.q === 'string' && q.q.trim()) { params.push(`%${q.q.trim().toLowerCase().replace(/[%_\\]/g, '\\$&')}%`); where.push(`lower(i.name) LIKE $${params.length}`); }
    if (q.only === 'uncounted') where.push('l.counted_qty IS NULL');
    if (q.only === 'diff' && sees) where.push('l.counted_qty IS NOT NULL AND l.counted_qty <> l.expected_qty');
    const all = q.all === '1';
    const { page, pageSize, offset } = all ? { page: 1, pageSize: 20000, offset: 0 } : pageParams({ page: q.page, page_size: q.page_size ?? 100 });
    const stats = (await this.db.one(
      `SELECT count(*)::int AS total, count(l.counted_qty)::int AS counted, count(*) FILTER (WHERE l.counted_qty IS NOT NULL AND l.counted_qty <> l.expected_qty)::int AS differences
         FROM inventory_count_lines l WHERE l.count_id = $1`, [id]))!;
    const matching = (await this.db.one(
      `SELECT count(*)::int AS n FROM inventory_count_lines l JOIN inventory_batches x ON x.id = l.batch_id JOIN inventory_items i ON i.id = x.item_id WHERE ${where.join(' AND ')}`, params))!.n;
    const lines = await this.db.rows(
      `SELECT l.id, l.batch_id, l.expected_qty, l.counted_qty, l.reason, x.batch_no, x.expiry_date, x.unit_cost, i.name, i.unit, i.controlled
         FROM inventory_count_lines l JOIN inventory_batches x ON x.id = l.batch_id JOIN inventory_items i ON i.id = x.item_id WHERE ${where.join(' AND ')}
        ORDER BY i.name, x.expiry_date NULLS LAST, l.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, offset]);
    return { data: {
      ...c, sees_expected: sees, lines_total: stats.total, lines_counted: stats.counted, differences: sees ? stats.differences : null,
      lines: lines.map((l) => ({ ...l, unit_cost: sees ? Number(l.unit_cost) : null, expected_qty: sees ? l.expected_qty : null })),
    }, meta: { page, page_size: pageSize, total: matching } };
  }

  /**
   * Snapshot of every batch with stock (or only controlled items: the monthly count) as the expected quantity. The
   * items in scope are locked first (B1): an issue or receipt running now finishes before the snapshot, and every later
   * one sees the open count and waits (409 COUNT_IN_PROGRESS) until it is handed in.
   */
  @Roles(...KEEPERS) @Post('counts')
  async startCount(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(whCountStartSchema, body);
    assertBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      if ((await c.query(`SELECT 1 FROM inventory_counts WHERE tenant_id = $1 AND branch_id = $2 AND status IN ('open','submitted')`, [ctx.tenantId, input.branch_id])).rowCount)
        throw conflict('COUNT_OPEN', 'Bu filialda inventarizatsiya allaqachon ochiq');
      await c.query(`SELECT id FROM inventory_items WHERE tenant_id = $1 AND branch_id = $2 ${input.scope === 'controlled' ? 'AND controlled' : ''} ORDER BY id FOR UPDATE`, [ctx.tenantId, input.branch_id]);
      const number = await nextNumber(c, ctx.tenantId, 'count');
      const id = (await c.query(
        `INSERT INTO inventory_counts (id, tenant_id, branch_id, number, scope, status, commission, started_by, started_by_name, started_at)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,'open',$5,$6,$7,$8) RETURNING id`,
        [ctx.tenantId, input.branch_id, number, input.scope, input.commission, ctx.membershipId, ctx.name, now()])).rows[0].id as string;
      const n = (await c.query(
        `INSERT INTO inventory_count_lines (id, tenant_id, count_id, batch_id, expected_qty)
         SELECT gen_random_uuid(), $1, $2, x.id, x.qty FROM inventory_batches x JOIN inventory_items i ON i.id = x.item_id
          WHERE i.tenant_id = $1 AND i.branch_id = $3 AND x.qty > 0 ${input.scope === 'controlled' ? 'AND i.controlled' : ''}`, [ctx.tenantId, id, input.branch_id])).rowCount;
      await audit(c, ctx, 'warehouse.count_start', 'inventory_count', id, `Inventarizatsiya I-${number} boshlandi (${n} partiya)`, input.branch_id);
      return { data: { id, number } };
    });
  }

  @Roles(...KEEPERS) @Put('counts/:id/lines')
  async countLines(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(whCountLinesSchema, body);
    if (!isUuid(id)) throw notFound('Inventarizatsiya');
    return this.db.tx(async (c) => {
      const cnt = (await c.query(`SELECT * FROM inventory_counts WHERE id = $1 AND tenant_id = $2 AND branch_id = ANY($3) FOR UPDATE`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!cnt) throw notFound('Inventarizatsiya');
      if (cnt.status !== 'open') throw staleState();
      for (const l of input.lines) {
        const r = await c.query(`UPDATE inventory_count_lines SET counted_qty = $3, reason = $4, counted_by = $5 WHERE id = $1 AND count_id = $2`,
          [l.line_id, id, l.counted_qty == null ? null : fromC(toC(l.counted_qty)), l.reason, ctx.membershipId || null]);
        // every editor is remembered on the count (never overwritten by a later editor)
        if (ctx.membershipId) await c.query(`UPDATE inventory_counts SET counters = array_append(counters, $2::uuid) WHERE id = $1 AND NOT ($2::uuid = ANY(counters))`, [id, ctx.membershipId]);
        if (!r.rowCount) throw invalid({ lines: 'Qator topilmadi' });
      }
      return { data: { ok: true } };
    });
  }

  @Roles(...KEEPERS) @Post('counts/:id/submit') @HttpCode(200)
  async submitCount(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Inventarizatsiya');
    return this.db.tx(async (c) => {
      const cnt = (await c.query(`SELECT * FROM inventory_counts WHERE id = $1 AND tenant_id = $2 AND branch_id = ANY($3) FOR UPDATE`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!cnt) throw notFound('Inventarizatsiya');
      if (cnt.status !== 'open') throw staleState();
      const missing = (await c.query(`SELECT count(*)::int AS n FROM inventory_count_lines WHERE count_id = $1 AND counted_qty IS NULL`, [id])).rows[0].n;
      if (missing) throw invalid({ lines: `${missing} ta qator sanalmagan` });
      // the count is blind: differences are found and explained by the manager on review (decide), not by the counter
      await c.query(`UPDATE inventory_counts SET status = 'submitted', submitted_at = $2, submitted_by = $3 WHERE id = $1`, [id, now(), ctx.membershipId || null]);
      await audit(c, ctx, 'warehouse.count_submit', 'inventory_count', id, `Inventarizatsiya I-${cnt.number} topshirildi`, cnt.branch_id);
      return { data: { ok: true } };
    });
  }

  /**
   * Approve → each difference becomes an adjustment movement on its batch; every difference needs a reason — the
   * counter's note or the manager's (`reasons`). Reject → cancelled. Movements made after the count was handed in stay
   * valid: issues and receipts of counted items were frozen while it was open (B1), so «counted − expected» is exactly
   * the shortage or surplus found and it is applied to today's balance.
   */
  @Roles('manager') @Post('counts/:id/decide') @HttpCode(200)
  async decideCount(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(whCountDecisionSchema, body);
    if (!isUuid(id)) throw notFound('Inventarizatsiya');
    return this.db.tx(async (c) => {
      const cnt = (await c.query(`SELECT * FROM inventory_counts WHERE id = $1 AND tenant_id = $2 AND branch_id = ANY($3) FOR UPDATE`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!cnt) throw notFound('Inventarizatsiya');
      if (cnt.status !== 'submitted') throw staleState();
      // the person who counted cannot approve their own differences (same rule as write-off acts)
      // nobody who started, counted or submitted the count decides its differences
      const counted = (cnt.counters ?? []).includes(ctx.membershipId);
      if (cnt.started_by === ctx.membershipId || cnt.submitted_by === ctx.membershipId || counted) throw conflict('SECOND_SIGNATURE', 'Ikkinchi imzo boshqa xodimdan bo‘lsin');
      const docNo = `${DOC_PREFIX.count}-${cnt.number}`;
      let adjusted = 0;
      if (input.approve) {
        const lines = (await c.query(`SELECT l.*, x.item_id, x.unit_cost, x.batch_no FROM inventory_count_lines l JOIN inventory_batches x ON x.id = l.batch_id WHERE l.count_id = $1 AND l.counted_qty <> l.expected_qty`, [id])).rows;
        const given = new Map(input.reasons.map((r) => [r.line_id, r.reason]));
        for (const l of lines) {
          if (given.has(l.id)) { l.reason = given.get(l.id); await c.query(`UPDATE inventory_count_lines SET reason = $2 WHERE id = $1`, [l.id, l.reason]); }
        }
        const noReason = lines.filter((l) => !l.reason?.trim()).length;
        if (noReason) throw invalid({ reasons: `${noReason} ta farq uchun sabab yozilmagan` });
        await lockItems(c, ctx, cnt.branch_id, lines.map((l) => l.item_id));
        for (const l of lines) {
          const diff = toC(l.counted_qty) - toC(l.expected_qty);
          if (diff > 0) await putBack(c, l.batch_id, diff); else await takeBatch(c, l.batch_id, -diff, l.batch_no ?? '');
          await insertMove(c, { tenantId: ctx.tenantId, itemId: l.item_id, branchId: cnt.branch_id, batchId: l.batch_id, type: diff > 0 ? 'in' : 'out', kind: 'adjust', qtyC: Math.abs(diff),
            unitCost: l.unit_cost, reason: `Inventarizatsiya ${docNo}: ${l.reason}`, actor: ctx, docNo, countId: id, secondSigner: { id: cnt.started_by, name: cnt.started_by_name } });
          adjusted++;
        }
      }
      await c.query(`UPDATE inventory_counts SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = $5 WHERE id = $1`, [id, input.approve ? 'approved' : 'cancelled', ctx.membershipId, ctx.name, now()]);
      await audit(c, ctx, input.approve ? 'warehouse.count_approve' : 'warehouse.count_cancel', 'inventory_count', id, `${docNo}: ${input.approve ? `tasdiqlandi, ${adjusted} ta tuzatish` : 'bekor qilindi'}`, cnt.branch_id);
      return { data: { ok: true, adjusted } };
    });
  }

  // ------------------------------------------------------------------ cold chain: devices and their temperature log
  /** The clinic's fridges, freezers and room thermometers (B6), each with its allowed range and the latest reading. */
  @Roles(...KEEPERS) @Get('fridge/devices')
  async devices(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const rows = await this.db.rows(
      `SELECT d.id, d.branch_id, b.name AS branch_name, d.name, d.kind, d.min_temp, d.max_temp, d.active,
              l.temperature AS last_temperature, l.recorded_at AS last_at, l.out_of_range AS last_out
         FROM cold_devices d JOIN branches b ON b.id = d.branch_id
         LEFT JOIN LATERAL (SELECT f.temperature, f.recorded_at, f.out_of_range FROM fridge_temperature_log f WHERE f.device_id = d.id ORDER BY f.recorded_at DESC LIMIT 1) l ON true
        WHERE d.tenant_id = $1 AND d.branch_id = ANY($2) ORDER BY d.active DESC, b.name, d.name LIMIT 200`, [ctx.tenantId, branchScope(ctx, q.branch_id)]);
    return { data: rows.map((r) => ({ ...r, min_temp: Number(r.min_temp), max_temp: Number(r.max_temp), last_temperature: r.last_temperature == null ? null : Number(r.last_temperature) })) };
  }

  /** A new device; the range defaults to its kind (fridge +2…+8, freezer −25…−15, room +15…+25 °C). */
  @Roles(...KEEPERS) @Post('fridge/devices')
  async addDevice(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(whColdDeviceSchema, body);
    assertBranch(ctx, input.branch_id);
    const [dMin, dMax] = COLD_DEVICE_RANGE[input.kind];
    const min = input.min_temp ?? dMin, max = input.max_temp ?? dMax;
    // the allowed range is the manager's decision, also on a new device (a storekeeper could otherwise add a wide one to hide alerts)
    if ((min !== dMin || max !== dMax) && ctx.role !== 'manager') throw forbidden('Harorat me’yorini faqat rahbar o‘zgartiradi');
    if (min >= max) throw invalid({ min_temp: 'Eng past harorat eng yuqoridan kichik bo‘lsin' });
    return this.db.tx(async (c) => {
      if ((await c.query(`SELECT 1 FROM cold_devices WHERE tenant_id = $1 AND branch_id = $2 AND lower(name) = lower($3)`, [ctx.tenantId, input.branch_id, input.name])).rowCount)
        throw conflict('DUPLICATE', 'Bu filialda shu nomli qurilma bor');
      const id = (await c.query(`INSERT INTO cold_devices (tenant_id, branch_id, name, kind, min_temp, max_temp, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ctx.tenantId, input.branch_id, input.name, input.kind, min, max, now()])).rows[0].id as string;
      await audit(c, ctx, 'warehouse.cold_device', 'cold_device', id, `Qurilma qo‘shildi: «${input.name}» (${min}…${max} °C)`, input.branch_id);
      return { data: { id } };
    });
  }

  /** Rename or retire a device; its allowed range is the manager's decision (a storekeeper cannot widen it to hide alerts). */
  @Roles(...KEEPERS) @Patch('fridge/devices/:id')
  async patchDevice(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(whColdDevicePatchSchema, body);
    if (!isUuid(id)) throw notFound('Qurilma');
    return this.db.tx(async (c) => {
      const d = (await c.query(`SELECT * FROM cold_devices WHERE id = $1 AND tenant_id = $2 AND branch_id = ANY($3) FOR UPDATE`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!d) throw notFound('Qurilma');
      const min = input.min_temp ?? Number(d.min_temp), max = input.max_temp ?? Number(d.max_temp);
      if ((min !== Number(d.min_temp) || max !== Number(d.max_temp)) && ctx.role !== 'manager') throw forbidden('Harorat me’yorini faqat rahbar o‘zgartiradi');
      // retiring a device stops its readings — also the manager's decision
      if (input.active === false && d.active && ctx.role !== 'manager') throw forbidden('Qurilmani faqat rahbar o‘chiradi');
      if (min >= max) throw invalid({ min_temp: 'Eng past harorat eng yuqoridan kichik bo‘lsin' });
      const name = input.name ?? d.name;
      if (name.toLowerCase() !== String(d.name).toLowerCase()
          && (await c.query(`SELECT 1 FROM cold_devices WHERE tenant_id = $1 AND branch_id = $2 AND lower(name) = lower($3) AND id <> $4`, [ctx.tenantId, d.branch_id, name, id])).rowCount)
        throw conflict('DUPLICATE', 'Bu filialda shu nomli qurilma bor');
      await c.query(`UPDATE cold_devices SET name = $2, min_temp = $3, max_temp = $4, active = $5 WHERE id = $1`, [id, name, min, max, input.active ?? d.active]);
      await audit(c, ctx, 'warehouse.cold_device', 'cold_device', id, `Qurilma: «${name}» ${min}…${max} °C${(input.active ?? d.active) ? '' : ', nofaol'}`, d.branch_id);
      return { data: { ok: true } };
    });
  }

  @Roles(...KEEPERS) @Get('fridge')
  async fridge(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { start, end } = period(q);
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), start, end];
    let dev = '';
    if (isUuid(q.device_id)) { params.push(q.device_id); dev = `AND f.device_id = $${params.length}`; }
    const rows = await this.db.rows(
      `SELECT f.id, f.device_id, f.fridge, d.kind, f.recorded_at, f.temperature, f.min_allowed, f.max_allowed, f.out_of_range, f.recorded_by_name, f.note, b.name AS branch_name
         FROM fridge_temperature_log f JOIN branches b ON b.id = f.branch_id JOIN cold_devices d ON d.id = f.device_id
        WHERE f.tenant_id = $1 AND f.branch_id = ANY($2) AND f.recorded_at >= $3 AND f.recorded_at < $4 ${dev}
        ORDER BY f.recorded_at DESC LIMIT 1000`, params);
    return { data: rows.map((r) => ({ ...r, temperature: Number(r.temperature), min_allowed: Number(r.min_allowed), max_allowed: Number(r.max_allowed) })) };
  }

  /** One reading of one device, checked against that device's range; outside it the action taken is required (B6). */
  @Roles(...KEEPERS) @Post('fridge')
  async addFridge(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(whFridgeSchema, body);
    return this.db.tx(async (c) => {
      const d = (await c.query(`SELECT * FROM cold_devices WHERE id = $1 AND tenant_id = $2 AND branch_id = ANY($3)`, [input.device_id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!d) throw notFound('Qurilma');
      if (!d.active) throw invalid({ device_id: 'Qurilma nofaol' });
      const t = Math.round(input.temperature * 10) / 10;
      const out = t < Number(d.min_temp) || t > Number(d.max_temp);
      if (out && (input.note ?? '').trim().length < 3) throw invalid({ note: 'Me’yordan tashqari: ko‘rilgan chorani yozing' });
      const r = (await c.query(
        `INSERT INTO fridge_temperature_log (id, tenant_id, branch_id, fridge, device_id, recorded_at, temperature, min_allowed, max_allowed, recorded_by, recorded_by_name, note)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, out_of_range`,
        [ctx.tenantId, d.branch_id, d.name, d.id, now(), t, d.min_temp, d.max_temp, ctx.membershipId, ctx.name, input.note])).rows[0];
      await audit(c, ctx, 'warehouse.fridge', 'fridge_log', r.id, `${d.name}: ${t} °C${r.out_of_range ? ' (me’yordan tashqari)' : ''}`, d.branch_id);
      return { data: { id: r.id, out_of_range: r.out_of_range } };
    });
  }

  // ------------------------------------------------------------------ reports
  private static GROUPS: Record<string, { key: string; label: string; join?: string; extra?: string }> = {
    doctor: { key: 'm.receiver_membership_id::text', label: 'max(m.receiver_name)' },
    patient: { key: 'm.patient_id::text', label: `max(p.last_name || ' ' || p.first_name || ' #' || p.patient_number)`, join: 'LEFT JOIN patients p ON p.id = m.patient_id' },
    icd: { key: 'm.icd_codes[1]', label: `max(m.icd_codes[1])`, extra: ', max(ic.title_uz) AS title_uz, max(ic.title_ru) AS title_ru', join: 'LEFT JOIN icd10_codes ic ON ic.code = m.icd_codes[1]' },
    service: { key: 'so.service_id::text', label: 'max(so.service_name)', join: 'LEFT JOIN service_orders so ON so.id = m.order_id' },
    department: { key: 'm.department', label: 'max(m.department)' },
    item: { key: 'm.item_id::text', label: `max(i.name || ', ' || i.unit)`, join: 'JOIN inventory_items i ON i.id = m.item_id' },
  };

  /**
   * Net consumption (issues − returns, voided rows excluded) for a period, grouped by doctor, patient, diagnosis (the
   * first ICD-10 code of the visit = the main diagnosis, so the groups add up to the total), procedure, department or item;
   * each group lists its items with the net quantity. Value is the sum of the ledger's integer tiyin values. By patient,
   * diagnosis, doctor or procedure — the manager only (B8); the storekeeper sees items and departments.
   */
  private async consumptionData(ctx: Ctx, q: any) {
    const { start, end, from, to } = period(q);
    const group = q.group in WarehouseController.GROUPS ? q.group : ctx.role === 'manager' ? 'doctor' : 'item';
    if (ctx.role !== 'manager' && !KEEPER_GROUPS.includes(group)) throw forbidden('Bemor, tashxis va shifokor bo‘yicha sarf hisoboti faqat rahbarga');
    const g = WarehouseController.GROUPS[group];
    const params = [ctx.tenantId, branchScope(ctx, q.branch_id), start, end];
    const WHERE = `m.tenant_id = $1 AND m.branch_id = ANY($2) AND m.occurred_at >= $3 AND m.occurred_at < $4 AND m.kind IN ('issue','return') AND m.voided_at IS NULL`;
    const NET = (col: string) => `sum(CASE WHEN m.kind = 'issue' THEN m.${col} ELSE -m.${col} END)`;
    const rows = await this.db.rows(
      `SELECT ${g.key} AS key, ${g.label} AS label, count(DISTINCT m.request_id)::int AS requests, ${NET('value')}::bigint AS value,
              count(DISTINCT m.patient_id)::int AS patients${g.extra ?? ''}
         FROM inventory_movements m ${g.join ?? ''} WHERE ${WHERE}
        GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 500`, params);
    const perItem = await this.db.rows(
      `SELECT ${g.key} AS key, m.item_id, max(it.name) AS name, max(it.unit) AS unit, ${NET('quantity')} AS qty, ${NET('value')}::bigint AS value
         FROM inventory_movements m JOIN inventory_items it ON it.id = m.item_id ${g.join ?? ''} WHERE ${WHERE}
        GROUP BY 1, 2 ORDER BY 6 DESC NULLS LAST, 3 LIMIT 5000`, params);
    const total = (await this.db.one(`SELECT coalesce(${NET('value')},0)::bigint AS value FROM inventory_movements m WHERE ${WHERE}`, params))!;
    const byKey = new Map<string | null, any[]>();
    for (const l of perItem) { const list = byKey.get(l.key) ?? []; list.push({ item_id: l.item_id, name: l.name, unit: l.unit, qty: l.qty, value: Number(l.value) }); byKey.set(l.key, list); }
    const keeper = ctx.role !== 'manager';
    return {
      from, to, group, total: Number(total.value),
      rows: rows.map((r) => {
        const items = byKey.get(r.key) ?? [];
        return { ...r, value: Number(r.value), ...(keeper ? { patients: null } : {}), qty: group === 'item' ? items[0]?.qty ?? '0' : null, unit: group === 'item' ? items[0]?.unit ?? null : null, items };
      }),
    };
  }

  @Roles(...KEEPERS) @Get('reports/consumption')
  async consumption(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const d = await this.consumptionData(ctx, q);
    return { data: { ...d, rows: d.rows.map((r) => ({ ...r, items: r.items.slice(0, 8), items_total: r.items.length })) } };
  }

  /** The same report as CSV: one row per group × item (quantity, unit, value), the totals row last. */
  @Roles(...KEEPERS) @Get('reports/consumption.csv')
  async consumptionCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    csvPeriod(q);
    const d = await this.consumptionData(ctx, q);
    const L = ctx.locale;
    const h = (k: string) => translate(L, `wh.rep.csv.${k}` as MessageKey);
    const out: unknown[][] = [];
    for (const r of d.rows) for (const it of r.items) out.push([r.label ?? '', it.name, fromC(toC(it.qty)), it.unit, csvSom(it.value)]);
    assertCsvRows(out.length);
    sendCsv(res, `ombor-sarfi-${d.group}-${d.from}-${d.to}.csv`, [translate(L, `wh.rep.by.${d.group}` as MessageKey), h('item'), h('qty'), h('unit'), h('value')],
      [...out, [h('total'), `${d.rows.length}`, '', '', csvSom(d.total)]]);
  }
}
