// Referral partners («yo‘llovchi shifokorlar / hamkorlar»), their payouts and reports, and the lead-source directory
// and report (docs/REFERRALS.md, migration 041).
// Privacy: percents, amounts and payouts are the manager's. Reception searches the directory (name, phone, code) and
// may quick-add a partner without a percent; a cashier sees only a partner's name on an invoice; a doctor sees nothing.
import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { leadSourceCreateSchema, leadSourceUpdateSchema, PARTNER_KIND_LABEL, partnerCreateSchema, partnerServicesSchema, partnerUpdateSchema, payoutCreateSchema, payoutVoidSchema, searchTranslit, type PartnerKind } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, conflict, forbidden, invalid, notFound } from '../core/errors';
import { isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { now } from '../core/clock';
import { branchScope } from '../core/scope';
import { csvPeriod, csvSom, sendCsv } from '../core/csv';
import { range } from './dashboard.controller';
import { LINE_QTY, NET_LINE, PARTNER_LINE } from './billing';
import { assertCashAvailable } from './cash.controller';
import { NEW_PATIENTS_SQL } from './referrals';

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/ /g, ' ');
/** Performed services on a live bill — the same rule as the doctor share (reports.controller PERFORMED). */
const PERFORMED = `o.status IN ('completed','verified') AND i.status <> 'void'`;
const PARTNER_LIST_COLS = `p.id, p.code, p.full_name, p.phone, p.kind, p.workplace, p.specialty, p.region, p.active, p.approved`;
const PARTNER_MANAGER_COLS = `${PARTNER_LIST_COLS}, p.default_percent, p.note, p.created_at`;

/** Average check in whole so‘m (tiyin, rounded to 100): revenue of the period / bills paid in it. */
const avgCheck = (revenue: number, checks: number) => (checks ? Math.round(revenue / checks / 100) * 100 : 0);

/** Lines of referred, performed services (aliases o, it, i): $1 tenant, $2 branches, optional period [$3, $4). */
const LINES_FROM = `FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
  WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.referral_partner_id IS NOT NULL AND ${PERFORMED}`;

/**
 * What the clinic owes each partner over all time in the person's branches: Σ partner amount of performed lines − Σ
 * active payouts. Ignores the report's period and branch filter: a debt does not start over each month.
 */
async function balances(q: Q, ctx: Ctx, partnerIds: string[] | null): Promise<Map<string, { due: number; paid: number }>> {
  const out = new Map<string, { due: number; paid: number }>();
  const filter = partnerIds ? 'AND o.referral_partner_id = ANY($3::uuid[])' : '';
  const params: unknown[] = [ctx.tenantId, ctx.branchIds, ...(partnerIds ? [partnerIds] : [])];
  for (const r of (await q.query(`SELECT o.referral_partner_id AS id, coalesce(sum(${PARTNER_LINE}),0)::bigint AS due ${LINES_FROM} ${filter} GROUP BY 1`, params)).rows)
    out.set(r.id, { due: Number(r.due), paid: 0 });
  const pf = partnerIds ? 'AND partner_id = ANY($3::uuid[])' : '';
  for (const r of (await q.query(`SELECT partner_id AS id, coalesce(sum(amount),0)::bigint AS paid FROM partner_payouts WHERE tenant_id = $1 AND branch_id = ANY($2) AND status = 'active' ${pf} GROUP BY 1`, params)).rows) {
    const b = out.get(r.id) ?? { due: 0, paid: 0 }; b.paid = Number(r.paid); out.set(r.id, b);
  }
  return out;
}

@Controller()
export class ReferralsController {
  constructor(private db: Db) {}

  // ---------------------------------------------------------------- directory

  /** Search by name (either script), phone or code. Reception gets the picker fields only — never a percent. */
  @Roles('manager', 'registrar') @Get('referral-partners')
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const params: unknown[] = [ctx.tenantId];
    const where = ['p.tenant_id = $1'];
    // reception picks only from active partners; the manager sees all unless filtered
    if (ctx.role !== 'manager' || q.active === '1') where.push('p.active');
    else if (q.active === '0') where.push('NOT p.active');
    const search = String(q.search ?? '').trim().slice(0, 80);
    if (search) {
      const like = (v: string) => `%${v.toLowerCase().replace(/[\\%_]/g, '\\$&').replace(/[‘’'`ʻʼ]/g, '_')}%`;
      const conds: string[] = [];
      params.push(like(search)); conds.push(`lower(p.full_name) LIKE $${params.length}`);
      const other = searchTranslit(search);
      if (other) { params.push(like(other)); conds.push(`lower(p.full_name) LIKE $${params.length}`); }
      const digits = search.replace(/[\s+\-()]/g, '');
      if (/^\d+$/.test(digits)) {
        if (digits.length <= 6) { params.push(Number(digits)); conds.push(`p.code = $${params.length}`); }
        if (digits.length >= 3) { params.push(`%${digits}%`); conds.push(`replace(coalesce(p.phone,''),'+','') LIKE $${params.length}`); }
      }
      where.push(`(${conds.join(' OR ')})`);
    }
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM referral_partners p WHERE ${where.join(' AND ')}`, params))!.n;
    params.push(pageSize, offset);
    const rows = await this.db.rows(`SELECT ${ctx.role === 'manager' ? PARTNER_MANAGER_COLS : PARTNER_LIST_COLS} FROM referral_partners p
      WHERE ${where.join(' AND ')} ORDER BY p.active DESC, p.full_name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  /** One partner with the per-service percents and the balance (manager). */
  @Roles('manager') @Get('referral-partners/:id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const p = await this.loadPartner(this.db.pool, ctx, id);
    const services = await this.db.rows(
      `SELECT ps.service_id, s.code, s.name, ps.percent FROM referral_partner_services ps JOIN services s ON s.id = ps.service_id WHERE ps.partner_id = $1 ORDER BY s.code`, [id]);
    const b = (await balances(this.db.pool, ctx, [id])).get(id) ?? { due: 0, paid: 0 };
    return { data: { ...p, services, due_total: b.due, paid_total: b.paid, balance: b.due - b.paid } };
  }

  /** Manager or reception (quick-add at the desk). Only the manager sets a percent. A known phone returns 409 with the card. */
  @Roles('manager', 'registrar') @Post('referral-partners') @HttpCode(201)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(partnerCreateSchema, body);
    if (ctx.role !== 'manager' && input.default_percent) throw forbidden('Foizni faqat rahbar belgilaydi');
    return this.db.tx(async (c) => {
      await c.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [ctx.tenantId]); // one code generator per clinic at a time
      if (input.phone) {
        const dup = (await c.query(`SELECT ${PARTNER_LIST_COLS} FROM referral_partners p WHERE p.tenant_id = $1 AND p.phone = $2 LIMIT 1`, [ctx.tenantId, input.phone])).rows[0];
        if (dup) { const e = coded(409, 'PARTNER_EXISTS', 'api.ref.exists', { code: dup.code }); e.extra = { partner: dup }; throw e; }
      }
      const code = (await c.query(`UPDATE tenants SET partner_seq = partner_seq + 1 WHERE id = $1 RETURNING partner_seq`, [ctx.tenantId])).rows[0].partner_seq;
      const row = (await c.query(
        `INSERT INTO referral_partners (tenant_id, code, full_name, phone, kind, workplace, specialty, region, note, default_percent, approved, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, demo_now(), demo_now()) RETURNING ${PARTNER_LIST_COLS.replace(/p\./g, '')}`,
        [ctx.tenantId, code, input.full_name, input.phone, input.kind, input.workplace, input.specialty, input.region, input.note, input.default_percent ?? 0,
          ctx.role === 'manager', ctx.membershipId || null])).rows[0];
      await audit(c, ctx, 'referral_partner.create', 'referral_partner', row.id, `Hamkor #${code} qo‘shildi${input.default_percent ? `, ${input.default_percent}%` : ''}`);
      return { data: row };
    });
  }

  @Roles('manager') @Patch('referral-partners/:id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(partnerUpdateSchema, body) as Record<string, any>;
    const FIELDS = ['full_name', 'phone', 'kind', 'workplace', 'specialty', 'region', 'note', 'default_percent', 'active', 'approved'];
    return this.db.tx(async (c) => {
      const p = await this.loadPartner(c, ctx, id, true);
      const keys = FIELDS.filter((k) => (body as any)?.[k] !== undefined && input[k] !== undefined && String(input[k]) !== String(p[k] ?? (k === 'default_percent' ? 0 : null)));
      if (!keys.length) return { data: { ok: true } };
      if (keys.includes('phone') && input.phone) {
        const dup = (await c.query(`SELECT code FROM referral_partners WHERE tenant_id = $1 AND phone = $2 AND id <> $3`, [ctx.tenantId, input.phone, id])).rows[0];
        if (dup) throw coded(409, 'PARTNER_EXISTS', 'api.ref.exists', { code: dup.code });
      }
      await c.query(`UPDATE referral_partners SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = demo_now() WHERE id = $1`, [id, ...keys.map((k) => input[k])]);
      const pct = keys.includes('default_percent') ? `, foiz: ${Number(p.default_percent)}% → ${input.default_percent}%` : '';
      await audit(c, ctx, 'referral_partner.update', 'referral_partner', id, `Hamkor #${p.code}: ${keys.filter((k) => k !== 'default_percent').join(', ') || 'foiz'}${pct}`);
      return { data: { ok: true } };
    });
  }

  /** This partner's own percent on chosen services (the whole list is replaced). Past lines keep their snapshot. */
  @Roles('manager') @Put('referral-partners/:id/services')
  async setServices(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { items } = parse(partnerServicesSchema, body);
    return this.db.tx(async (c) => {
      const p = await this.loadPartner(c, ctx, id, true);
      const ids = [...new Set(items.map((x) => x.service_id))];
      if (ids.length !== items.length) throw invalid({ items: 'Xizmat ikki marta kiritilgan' });
      const known = (await c.query(`SELECT count(*)::int AS n FROM services WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [ctx.tenantId, ids])).rows[0].n;
      if (known !== ids.length) throw invalid({ items: 'Xizmat topilmadi' });
      await c.query(`DELETE FROM referral_partner_services WHERE partner_id = $1`, [id]);
      for (const x of items) await c.query(`INSERT INTO referral_partner_services (tenant_id, partner_id, service_id, percent) VALUES ($1,$2,$3,$4)`, [ctx.tenantId, id, x.service_id, x.percent]);
      await audit(c, ctx, 'referral_partner.services', 'referral_partner', id, `Hamkor #${p.code}: ${items.length} ta xizmat foizi`);
      return { data: { ok: true, count: items.length } };
    });
  }

  private async loadPartner(q: Q, ctx: Ctx, id: string, lock = false) {
    if (!isUuid(id)) throw notFound('Hamkor');
    const p = (await q.query(`SELECT ${PARTNER_MANAGER_COLS} FROM referral_partners p WHERE p.id = $1 AND p.tenant_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, ctx.tenantId])).rows[0];
    if (!p) throw notFound('Hamkor');
    return p;
  }

  // ---------------------------------------------------------------- report

  private async reportRows(ctx: Ctx, q: any) {
    const r = range(q);
    const P = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    const lines = await this.db.rows(
      `SELECT o.referral_partner_id AS partner_id, count(DISTINCT o.patient_id)::int AS patients, count(DISTINCT o.appointment_id)::int AS visits,
              coalesce(sum(${LINE_QTY}),0)::int AS services, coalesce(sum(${NET_LINE}),0)::bigint AS net, coalesce(sum(${PARTNER_LINE}),0)::bigint AS due
         ${LINES_FROM} AND o.performed_at >= $3 AND o.performed_at < $4 GROUP BY 1`, P);
    const paid = await this.db.rows(`SELECT partner_id, count(*)::int AS n, coalesce(sum(amount),0)::bigint AS paid FROM partner_payouts
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4 AND status = 'active' GROUP BY 1`, P);
    const bal = await balances(this.db.pool, ctx, null);
    const ids = [...new Set([...lines.map((x) => x.partner_id), ...paid.map((x) => x.partner_id), ...[...bal.entries()].filter(([, b]) => b.due !== b.paid).map(([id]) => id)])];
    const partners = ids.length ? await this.db.rows(`SELECT ${PARTNER_MANAGER_COLS} FROM referral_partners p WHERE p.tenant_id = $1 AND p.id = ANY($2::uuid[])`, [ctx.tenantId, ids]) : [];
    const rows = partners.map((p) => {
      const l = lines.find((x) => x.partner_id === p.id), pd = paid.find((x) => x.partner_id === p.id), b = bal.get(p.id) ?? { due: 0, paid: 0 };
      return { partner_id: p.id, code: p.code, full_name: p.full_name, kind: p.kind, workplace: p.workplace, phone: p.phone, default_percent: Number(p.default_percent), active: p.active,
        patients: l?.patients ?? 0, visits: l?.visits ?? 0, services: l?.services ?? 0, net: Number(l?.net ?? 0), due: Number(l?.due ?? 0), paid: Number(pd?.paid ?? 0), balance: b.due - b.paid };
    }).sort((a, b) => b.due - a.due || b.balance - a.balance || a.full_name.localeCompare(b.full_name));
    const sum = (k: 'patients' | 'visits' | 'services' | 'net' | 'due' | 'paid' | 'balance') => rows.reduce((a, x) => a + x[k], 0);
    return { r, rows, totals: { patients: sum('patients'), visits: sum('visits'), services: sum('services'), net: sum('net'), due: sum('due'), paid: sum('paid'), balance: sum('balance') } };
  }

  /** Per partner for a period: patients, visits, services, their net value, the amount due, payouts; balance = all time. */
  @Roles('manager') @Get('reports/referrals')
  async report(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { r, rows, totals } = await this.reportRows(ctx, q);
    return { data: rows, meta: { from: r.from, to: r.to, totals } };
  }

  @Roles('manager') @Get('reports/referrals/export.csv')
  async reportCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const { rows, totals } = await this.reportRows(ctx, q);
    sendCsv(res, `meduzai-hamkorlar-${period.from}-${period.to}.csv`,
      ['ID', 'Hamkor', 'Turi', 'Ish joyi', 'Telefon', 'Foiz', 'Bemorlar', 'Qabullar', 'Xizmatlar', 'Xizmatlar qiymati (so‘m)', 'Hamkor ulushi (so‘m)', 'To‘langan (so‘m)', 'Qoldiq, jami (so‘m)'],
      [...rows.map((x) => [x.code, x.full_name, PARTNER_KIND_LABEL[x.kind as PartnerKind] ?? x.kind, x.workplace, x.phone, `${x.default_percent}%`, x.patients, x.visits, x.services,
          csvSom(x.net), csvSom(x.due), csvSom(x.paid), csvSom(x.balance)]),
        ['Jami', `${rows.length} ta hamkor`, '', '', '', '', totals.patients, totals.visits, totals.services, csvSom(totals.net), csvSom(totals.due), csvSom(totals.paid), csvSom(totals.balance)]]);
  }

  /** One partner's lines of a period (who, when, which service, its net value, the percent and the amount). */
  @Roles('manager') @Get('reports/referrals/:id/lines')
  async lines(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    await this.loadPartner(this.db.pool, ctx, id);
    const r = range(q);
    const { page, pageSize, offset } = pageParams(q);
    const P: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end, id];
    const where = `${LINES_FROM} AND o.performed_at >= $3 AND o.performed_at < $4 AND o.referral_partner_id = $5`;
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(${NET_LINE}),0)::bigint AS net, coalesce(sum(${PARTNER_LINE}),0)::bigint AS due ${where}`, P))!;
    const rows = await this.db.rows(
      `SELECT o.id AS order_id, o.performed_at, o.service_name, it.quantity, i.invoice_number, p.patient_number, p.last_name, p.first_name,
              ${NET_LINE}::bigint AS net, o.partner_percent_snapshot AS percent, ${PARTNER_LINE}::bigint AS due
         ${where.replace('FROM service_orders o', 'FROM service_orders o JOIN patients p ON p.id = o.patient_id')} ORDER BY o.performed_at DESC, o.id LIMIT $6 OFFSET $7`, [...P, pageSize, offset]);
    return { data: rows.map((x) => ({ ...x, net: Number(x.net), due: Number(x.due), percent: Number(x.percent) })),
      meta: { from: r.from, to: r.to, page, page_size: pageSize, count: agg.n, net: Number(agg.net), due: Number(agg.due) } };
  }

  // ---------------------------------------------------------------- payouts

  /**
   * Money paid to a partner. Cash leaves an open drawer (locked; INSUFFICIENT_CASH like every outflow), a transfer is
   * booked to a branch. Never more than the partner's balance. Idempotency-Key: a retry returns the original payout.
   */
  @Roles('manager') @Post('referral-payouts')
  async pay(@CurrentCtx() ctx: Ctx, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (!key || key.length < 8 || key.length > 100) throw new AppError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key sarlavhasi majburiy');
    const input = parse(payoutCreateSchema, body);
    const fp = (x: { partner_id: string; amount: unknown; method: string }) => createHash('sha256').update(`${x.partner_id}|${x.amount}|${x.method}`).digest('hex');
    return this.db.tx(async (c) => {
      const prev = (await c.query(`SELECT * FROM partner_payouts WHERE tenant_id = $1 AND idempotency_key = $2`, [ctx.tenantId, key])).rows[0];
      if (prev) {
        if (fp(prev) !== fp(input)) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'Bu kalit boshqa amal uchun ishlatilgan');
        res.status(200);
        return { data: { payout: prev, replayed: true } };
      }
      // the partner row is the lock that serialises two payouts of the same balance
      const p = await this.loadPartner(c, ctx, input.partner_id, true);
      const b = (await balances(c, ctx, [p.id])).get(p.id) ?? { due: 0, paid: 0 };
      if (input.amount > b.due - b.paid) throw coded(409, 'PAYOUT_OVER_BALANCE', 'api.ref.overBalance', { amount: som(Math.max(0, b.due - b.paid)) });
      let shiftId: string | null = null;
      let branchId = input.branch_id ?? ctx.branchIds[0];
      if (input.method === 'cash') {
        if (!input.shift_id) throw invalid({ shift_id: 'Naqd pul qaysi kassadan berilishini tanlang (ochiq smena)' });
        // cash leaving the drawer: an exclusive lock, so two outflows cannot both pass the «enough cash» check
        const sh = (await c.query(`SELECT id, branch_id FROM cash_shifts WHERE id = $1 AND tenant_id = $2 AND status = 'open' FOR UPDATE`, [input.shift_id, ctx.tenantId])).rows[0];
        if (!sh || !ctx.branchIds.includes(sh.branch_id)) throw conflict('SHIFT_NOT_OPEN', 'Tanlangan smena yopilgan yoki topilmadi');
        await assertCashAvailable(c, sh.id, input.amount);
        shiftId = sh.id; branchId = sh.branch_id;
      } else if (!branchId || !ctx.branchIds.includes(branchId)) throw invalid({ branch_id: 'Filialni tanlang' });
      const row = (await c.query(
        `INSERT INTO partner_payouts (tenant_id, branch_id, partner_id, amount, method, shift_id, note, paid_at, created_by, created_by_name, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [ctx.tenantId, branchId, p.id, input.amount, input.method, shiftId, input.note, now(), ctx.membershipId || null, ctx.name, key])).rows[0];
      await audit(c, ctx, 'referral_payout.create', 'referral_partner', p.id, `Hamkor #${p.code}ga to‘lov: ${som(input.amount)} so‘m (${input.method === 'cash' ? 'naqd, kassadan' : 'o‘tkazma'})`, branchId);
      res.status(201);
      return { data: { payout: row, replayed: false } };
    });
  }

  @Roles('manager') @Get('referral-payouts')
  async payouts(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const r = range(q);
    const { page, pageSize, offset } = pageParams(q);
    const P: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    let where = `pp.tenant_id = $1 AND pp.branch_id = ANY($2) AND pp.paid_at >= $3 AND pp.paid_at < $4`;
    if (isUuid(q.partner_id)) { P.push(q.partner_id); where += ` AND pp.partner_id = $${P.length}`; }
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(amount) FILTER (WHERE status = 'active'),0)::bigint AS total FROM partner_payouts pp WHERE ${where}`, P))!;
    const rows = await this.db.rows(
      `SELECT pp.id, pp.amount, pp.method, pp.paid_at, pp.note, pp.status, pp.void_reason, pp.voided_by_name, pp.created_by_name, pp.shift_id, s.number AS shift_number, s.status AS shift_status,
              b.name AS branch_name, rp.id AS partner_id, rp.code AS partner_code, rp.full_name AS partner_name
         FROM partner_payouts pp JOIN referral_partners rp ON rp.id = pp.partner_id JOIN branches b ON b.id = pp.branch_id LEFT JOIN cash_shifts s ON s.id = pp.shift_id
        WHERE ${where} ORDER BY pp.paid_at DESC LIMIT $${P.length + 1} OFFSET $${P.length + 2}`, [...P, pageSize, offset]);
    return { data: rows, meta: { from: r.from, to: r.to, page, page_size: pageSize, count: agg.n, total: Number(agg.total) } };
  }

  /** Void once, with a reason. A cash payout of a closed shift stays: the shift report is final. */
  @Roles('manager') @Post('referral-payouts/:id/void') @HttpCode(200)
  async voidPayout(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('To‘lov');
    const { reason } = parse(payoutVoidSchema, body);
    return this.db.tx(async (c) => {
      const p = (await c.query(`SELECT pp.*, rp.code FROM partner_payouts pp JOIN referral_partners rp ON rp.id = pp.partner_id WHERE pp.id = $1 AND pp.tenant_id = $2 FOR UPDATE OF pp`, [id, ctx.tenantId])).rows[0];
      if (!p || !ctx.branchIds.includes(p.branch_id)) throw notFound('To‘lov');
      if (p.status === 'void') throw coded(409, 'ALREADY_VOID', 'api.ref.alreadyVoid');
      if (p.shift_id) {
        const sh = (await c.query(`SELECT status FROM cash_shifts WHERE id = $1 FOR SHARE`, [p.shift_id])).rows[0];
        if (sh?.status !== 'open') throw coded(409, 'SHIFT_CLOSED', 'api.ref.shiftClosed');
      }
      await c.query(`UPDATE partner_payouts SET status = 'void', void_reason = $2, voided_at = demo_now(), voided_by_name = $3 WHERE id = $1`, [id, reason, ctx.name]);
      await audit(c, ctx, 'referral_payout.void', 'referral_partner', p.partner_id, `Hamkor #${p.code}ga to‘lov bekor qilindi: ${som(Number(p.amount))} so‘m`, p.branch_id);
      return { data: { ok: true } };
    });
  }

  // ---------------------------------------------------------------- lead sources

  /** The directory: reception gets the active ones for its pickers, the manager every row (`?all=1`). */
  @Roles('manager', 'registrar') @Get('lead-sources')
  async sources(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const all = ctx.role === 'manager' && q.all === '1';
    const rows = await this.db.rows(`SELECT id, name, system_key, active, sort FROM lead_sources WHERE tenant_id = $1 ${all ? '' : 'AND active'} ORDER BY sort, name LIMIT 200`, [ctx.tenantId]);
    return { data: rows };
  }

  @Roles('manager') @Post('lead-sources') @HttpCode(201)
  async createSource(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(leadSourceCreateSchema, body);
    return this.db.tx(async (c) => {
      if ((await c.query(`SELECT 1 FROM lead_sources WHERE tenant_id = $1 AND lower(name) = lower($2)`, [ctx.tenantId, input.name])).rowCount) throw coded(409, 'DUPLICATE', 'api.ref.sourceExists');
      const sort = input.sort ?? (await c.query(`SELECT coalesce(max(sort), 0) + 10 AS s FROM lead_sources WHERE tenant_id = $1 AND sort < 10000`, [ctx.tenantId])).rows[0].s;
      const row = (await c.query(`INSERT INTO lead_sources (tenant_id, name, sort) VALUES ($1,$2,$3) RETURNING id, name, system_key, active, sort`, [ctx.tenantId, input.name, Math.min(sort, 10000)])).rows[0];
      await audit(c, ctx, 'lead_source.create', 'lead_source', row.id, `Manba qo‘shildi: ${input.name}`);
      return { data: row };
    });
  }

  /** Rename, reorder, switch off. A built-in source (the bot's, the referral one) is never switched off. */
  @Roles('manager') @Patch('lead-sources/:id')
  async updateSource(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('Manba');
    const input = parse(leadSourceUpdateSchema, body);
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT * FROM lead_sources WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!s) throw notFound('Manba');
      if (input.active === false && s.system_key) throw coded(409, 'SYSTEM_SOURCE', 'api.ref.systemSource');
      if (input.name && input.name.toLowerCase() !== String(s.name).toLowerCase()
        && (await c.query(`SELECT 1 FROM lead_sources WHERE tenant_id = $1 AND lower(name) = lower($2) AND id <> $3`, [ctx.tenantId, input.name, id])).rowCount) throw coded(409, 'DUPLICATE', 'api.ref.sourceExists');
      await c.query(`UPDATE lead_sources SET name = COALESCE($2, name), sort = COALESCE($3, sort), active = COALESCE($4, active) WHERE id = $1`, [id, input.name ?? null, input.sort ?? null, input.active ?? null]);
      await audit(c, ctx, 'lead_source.update', 'lead_source', id, `Manba: ${input.name ?? s.name}${input.active === false ? ' (o‘chirildi)' : input.active ? ' (yoqildi)' : ''}`);
      return { data: { ok: true } };
    });
  }

  private async sourceRows(ctx: Ctx, q: any) {
    const r = range(q);
    const branches = branchScope(ctx, q.branch_id);
    const P = [ctx.tenantId, branches, r.start, r.end];
    // new patients: their first visit ever (came) falls in the period, counted by the card's first known source
    const fresh = await this.db.rows(NEW_PATIENTS_SQL, P);
    // bookings that were due in the period (a future booking of today is not yet a «no»): came = arrived, in progress or completed
    const visits = await this.db.rows(
      `SELECT lead_source_id AS id, count(*) FILTER (WHERE status <> 'scheduled' OR starts_at < (SELECT demo_now()))::int AS booked,
              count(*) FILTER (WHERE status IN ('arrived','in_progress','completed'))::int AS came
         FROM appointments WHERE tenant_id = $1 AND branch_id = ANY($2) AND starts_at >= $3 AND starts_at < $4 GROUP BY 1`, P);
    // revenue: the dashboard's cash basis (payments − refunds of the period), attributed through the bill's visit
    const money = await this.db.rows(
      `WITH pay AS (SELECT pm.invoice_id, pm.amount FROM payments pm WHERE pm.tenant_id = $1 AND pm.branch_id = ANY($2) AND pm.paid_at >= $3 AND pm.paid_at < $4),
            ref AS (SELECT rf.invoice_id, rf.amount FROM refunds rf WHERE rf.tenant_id = $1 AND rf.branch_id = ANY($2) AND rf.refunded_at >= $3 AND rf.refunded_at < $4)
       SELECT a.lead_source_id AS id, coalesce(sum(x.amount),0)::bigint AS revenue, count(DISTINCT x.invoice_id) FILTER (WHERE x.kind = 'pay')::int AS checks
         FROM (SELECT invoice_id, amount, 'pay' AS kind FROM pay UNION ALL SELECT invoice_id, -amount, 'ref' FROM ref) x
         JOIN invoices i ON i.id = x.invoice_id LEFT JOIN appointments a ON a.id = i.appointment_id
        GROUP BY 1`, P);
    const sources = await this.db.rows(`SELECT id, name, system_key, active, sort FROM lead_sources WHERE tenant_id = $1 ORDER BY sort, name`, [ctx.tenantId]);
    const keyOf = (id: string | null) => id ?? 'none';
    const ids = new Set<string>([...sources.filter((s) => s.active).map((s) => s.id), ...[...fresh, ...visits, ...money].map((x) => keyOf(x.id))]);
    const rows = [...ids].map((id) => {
      const s = sources.find((x) => x.id === id);
      const f = fresh.find((x) => keyOf(x.id) === id), v = visits.find((x) => keyOf(x.id) === id), m = money.find((x) => keyOf(x.id) === id);
      const revenue = Number(m?.revenue ?? 0), checks = m?.checks ?? 0, booked = v?.booked ?? 0, came = v?.came ?? 0;
      return { source_id: id === 'none' ? null : id, name: s?.name ?? null, system_key: s?.system_key ?? null, sort: s?.sort ?? 100000,
        new_patients: f?.n ?? 0, booked, came, conversion: booked ? Math.round((came / booked) * 1000) / 10 : null, revenue, checks, average_check: avgCheck(revenue, checks) };
    }).sort((a, b) => b.revenue - a.revenue || b.new_patients - a.new_patients || a.sort - b.sort);
    const sum = (k: 'new_patients' | 'booked' | 'came' | 'revenue' | 'checks') => rows.reduce((a, x) => a + x[k], 0);
    const totals = { new_patients: sum('new_patients'), booked: sum('booked'), came: sum('came'), revenue: sum('revenue'), checks: sum('checks') };
    return { r, rows, totals: { ...totals, conversion: totals.booked ? Math.round((totals.came / totals.booked) * 1000) / 10 : null, average_check: avgCheck(totals.revenue, totals.checks) } };
  }

  /** «Manbalar bo‘yicha»: new cards, bookings → visits, revenue (cash basis, net of refunds) and the average check per source. */
  @Roles('manager') @Get('reports/lead-sources')
  async sourceReport(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { r, rows, totals } = await this.sourceRows(ctx, q);
    return { data: rows, meta: { from: r.from, to: r.to, totals } };
  }

  @Roles('manager') @Get('reports/lead-sources/export.csv')
  async sourceCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const { rows, totals } = await this.sourceRows(ctx, q);
    const pct = (v: number | null) => (v == null ? '' : `${v}%`);
    sendCsv(res, `meduzai-manbalar-${period.from}-${period.to}.csv`,
      ['Manba', 'Yangi bemorlar', 'Yozilgan', 'Kelgan', 'Konversiya', 'Tushum (so‘m)', 'Cheklar', 'O‘rtacha chek (so‘m)'],
      [...rows.map((x) => [x.name ?? 'Ko‘rsatilmagan', x.new_patients, x.booked, x.came, pct(x.conversion), csvSom(x.revenue), x.checks, csvSom(x.average_check)]),
        ['Jami', totals.new_patients, totals.booked, totals.came, pct(totals.conversion), csvSom(totals.revenue), totals.checks, csvSom(totals.average_check)]]);
  }
}
