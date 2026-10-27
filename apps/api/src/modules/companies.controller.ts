// «Kompaniyalar»: employers and insurers that pay for their people — directory, the company split of a bill, company
// payments (bank transfers) and their void, receivables with ageing, the statement and the reconciliation act
// (docs/DISCOUNTS_COMPANIES.md, migration 043).
// Roles: the manager — everything. Cashier — the directory (no notes), the split on a bill, company payments, the open
// bills of a company. Registrar — company names for the patient card. Doctor, lab, storekeeper, guard: 403.
import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { COMPANY_KIND_LABEL, companyPaymentSchema, companyPaymentVoidSchema, companySchema, companySplitSchema, type CompanyKind } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, notFound } from '../core/errors';
import { isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { branchScope } from '../core/scope';
import { csvDate, csvPeriod, csvSom, csvTime, sendCsv } from '../core/csv';
import { range } from './dashboard.controller';
import { COMPANY_DUE } from './billing';
import { companyOutstanding, createCompanyPayment, setCompanySplit, voidCompanyPayment } from './companies';

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/ /g, ' ');
const LIST_COLS = `c.id, c.name, c.kind, c.inn, c.active, c.coverage_percent, c.coverage_categories, c.discount_rule_id, c.payment_terms_days, c.credit_limit`;
const FULL_COLS = `${LIST_COLS}, c.contract_number, c.contract_date, c.contact_name, c.contact_phone, c.note, c.created_at`;
/** Days since the bill (demo clock) and the receivable buckets of a company statement. */
const AGE = `floor(EXTRACT(EPOCH FROM ((SELECT demo_now()) - i.created_at)) / 86400)`;
export const COMPANY_AGE_BUCKETS: Record<string, string> = { '0-30': `${AGE} <= 30`, '31-60': `${AGE} BETWEEN 31 AND 60`, '61+': `${AGE} >= 61` };

@Controller()
export class CompaniesController {
  constructor(private db: Db) {}

  // ---------------------------------------------------------------- directory

  /** Registrar: active names only (the card picker). Cashier: + coverage and the receivable. Manager: everything (`all=1` with inactive). */
  @Roles('manager', 'cashier', 'registrar') @Get('companies')
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const params: unknown[] = [ctx.tenantId];
    const where = ['c.tenant_id = $1'];
    if (!(ctx.role === 'manager' && q.all === '1')) where.push('c.active');
    const search = String(q.search ?? '').trim().slice(0, 80);
    if (search) { params.push(`%${search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`); where.push(`(lower(c.name) LIKE $${params.length} OR c.inn LIKE $${params.length})`); }
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM companies c WHERE ${where.join(' AND ')}`, params))!.n;
    params.push(pageSize, offset);
    if (ctx.role === 'registrar') {
      const rows = await this.db.rows(`SELECT c.id, c.name, c.kind FROM companies c WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { data: rows, meta: { page, page_size: pageSize, total } };
    }
    params.push(ctx.branchIds);
    const rows = await this.db.rows(
      `SELECT ${ctx.role === 'manager' ? FULL_COLS : LIST_COLS},
              (SELECT coalesce(sum(${COMPANY_DUE()}),0) FROM invoices i WHERE i.company_id = c.id AND i.status <> 'void' AND i.branch_id = ANY($${params.length}))::bigint AS outstanding
         FROM companies c WHERE ${where.join(' AND ')} ORDER BY c.active DESC, c.name LIMIT $${params.length - 2} OFFSET $${params.length - 1}`, params);
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  @Roles('manager', 'cashier') @Get('companies/:id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const c = await this.load(this.db.pool, ctx, id);
    const outstanding = await companyOutstanding(this.db.pool, ctx.tenantId, id);
    if (ctx.role !== 'manager') for (const k of ['note', 'contact_name', 'contact_phone', 'contract_number', 'contract_date']) delete c[k];
    return { data: { ...c, outstanding, over_limit: Number(c.credit_limit) > 0 && outstanding > Number(c.credit_limit) } };
  }

  @Roles('manager') @Post('companies') @HttpCode(201)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(companySchema, body);
    return this.db.tx(async (c) => {
      await this.checkRule(c, ctx, input.discount_rule_id);
      await this.checkUnique(c, ctx, input, null);
      const row = (await c.query(
        `INSERT INTO companies (tenant_id, name, kind, inn, contract_number, contract_date, contact_name, contact_phone, note, discount_rule_id, coverage_percent, coverage_categories,
                                payment_terms_days, credit_limit, active, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, demo_now(), demo_now()) RETURNING id`, this.params(ctx, input))).rows[0];
      await audit(c, ctx, 'company.create', 'company', row.id, `Kompaniya qo‘shildi: «${input.name}»`);
      return { data: row };
    });
  }

  @Roles('manager') @Patch('companies/:id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(companySchema, body);
    return this.db.tx(async (c) => {
      const cur = await this.load(c, ctx, id, true);
      await this.checkRule(c, ctx, input.discount_rule_id);
      await this.checkUnique(c, ctx, input, id);
      const p = this.params(ctx, input);
      await c.query(`UPDATE companies SET name = $2, kind = $3, inn = $4, contract_number = $5, contract_date = $6, contact_name = $7, contact_phone = $8, note = $9, discount_rule_id = $10,
          coverage_percent = $11, coverage_categories = $12, payment_terms_days = $13, credit_limit = $14, active = $15, updated_at = demo_now() WHERE id = $1`, [id, ...p.slice(1, 15)]);
      const limit = Number(cur.credit_limit) !== input.credit_limit ? `, kredit limiti: ${som(Number(cur.credit_limit))} → ${som(input.credit_limit)} so‘m` : '';
      await audit(c, ctx, 'company.update', 'company', id, `Kompaniya o‘zgardi: «${input.name}»${limit}${input.active === false ? ' (o‘chirildi)' : ''}`);
      return { data: { ok: true } };
    });
  }

  private params(ctx: Ctx, i: ReturnType<typeof companySchema.parse>) {
    return [ctx.tenantId, i.name, i.kind, i.inn, i.contract_number, i.contract_date, i.contact_name, i.contact_phone, i.note, i.discount_rule_id ?? null, i.coverage_percent,
      i.coverage_categories, i.payment_terms_days, i.credit_limit, i.active ?? true, ctx.membershipId || null];
  }
  private async checkRule(c: Q, ctx: Ctx, id: string | null | undefined) {
    if (id && !(await c.query(`SELECT 1 FROM discount_rules WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])).rowCount) throw coded(422, 'VALIDATION', 'api.disc.ruleNotFound');
  }
  private async checkUnique(c: Q, ctx: Ctx, i: { name: string; inn: string | null }, id: string | null) {
    const dup = (await c.query(`SELECT 1 FROM companies WHERE tenant_id = $1 AND (lower(name) = lower($2) OR ($3::text IS NOT NULL AND inn = $3)) AND ($4::uuid IS NULL OR id <> $4)`,
      [ctx.tenantId, i.name, i.inn, id])).rowCount;
    if (dup) throw coded(409, 'COMPANY_EXISTS', 'api.comp.exists');
  }
  private async load(q: Q, ctx: Ctx, id: string, lock = false) {
    if (!isUuid(id)) throw notFound('Kompaniya');
    const c = (await q.query(`SELECT ${FULL_COLS} FROM companies c WHERE c.id = $1 AND c.tenant_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, ctx.tenantId])).rows[0];
    if (!c) throw notFound('Kompaniya');
    return c;
  }

  /** A company's bills with something still to pay, oldest first (the allocation picker of a company payment). */
  @Roles('manager', 'cashier') @Get('companies/:id/open-invoices')
  async openInvoices(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    await this.load(this.db.pool, ctx, id);
    const { page, pageSize, offset } = pageParams(q);
    const P = [ctx.tenantId, id, ctx.branchIds];
    const where = `i.tenant_id = $1 AND i.company_id = $2 AND i.branch_id = ANY($3) AND i.status <> 'void' AND ${COMPANY_DUE()} > 0`;
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(${COMPANY_DUE()}),0)::bigint AS due FROM invoices i WHERE ${where}`, P))!;
    const rows = await this.db.rows(
      `SELECT i.id, i.invoice_number, i.created_at, ${AGE}::int AS age_days, i.company_share_amount, i.company_paid_amount, ${COMPANY_DUE()} AS due, i.company_member_no,
              p.patient_number, p.last_name, p.first_name, b.name AS branch_name
         FROM invoices i JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = i.branch_id
        WHERE ${where} ORDER BY i.created_at, i.invoice_number LIMIT $4 OFFSET $5`, [...P, pageSize, offset]);
    return { data: rows, meta: { page, page_size: pageSize, total: agg.n, due: Number(agg.due) } };
  }

  // ---------------------------------------------------------------- on a bill

  /** Company split of an open bill (cashier or manager). Above the credit limit or the coverage percent: manager only. */
  @Roles('manager', 'cashier') @Post('invoices/:id/company') @HttpCode(200)
  async split(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(companySplitSchema, body);
    return this.db.tx(async (c) => ({ data: await setCompanySplit(c, ctx, id, input) }));
  }

  // ---------------------------------------------------------------- company payments

  @Roles('manager', 'cashier') @Post('company-payments')
  async pay(@CurrentCtx() ctx: Ctx, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (!key || key.length < 8 || key.length > 100) throw new AppError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key sarlavhasi majburiy');
    const input = parse(companyPaymentSchema, body);
    // the same request again (a lost answer) returns the first payment; the same key for another payment is refused
    const fp = (company: string, amount: number, allocs: { invoice_id: string; amount: number }[]) => createHash('sha256')
      .update(JSON.stringify([company, amount, allocs.map((a) => [a.invoice_id, Number(a.amount)]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))])).digest('hex');
    return this.db.tx(async (c) => {
      const prev = (await c.query(`SELECT cp.*, (SELECT json_agg(json_build_object('invoice_id', a.invoice_id, 'amount', a.amount)) FROM company_payment_allocations a WHERE a.company_payment_id = cp.id) AS allocs
          FROM company_payments cp WHERE cp.tenant_id = $1 AND cp.idempotency_key = $2`, [ctx.tenantId, key])).rows[0];
      if (prev) {
        if (fp(prev.company_id, Number(prev.amount), prev.allocs ?? []) !== fp(input.company_id, input.amount, input.allocations))
          throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'Bu kalit boshqa to‘lov uchun ishlatilgan');
        delete prev.allocs;
        res.status(200);
        return { data: { payment: prev, replayed: true } };
      }
      const r = await createCompanyPayment(c, ctx, input, key);
      res.status(201);
      return { data: { ...r, replayed: false } };
    });
  }

  private paymentFilters(ctx: Ctx, q: any) {
    const r = range(q);
    const params: unknown[] = [ctx.tenantId, r.start, r.end, branchScope(ctx, q.branch_id)];
    const where = [`cp.tenant_id = $1`, `cp.received_at >= $2`, `cp.received_at < $3`,
      `EXISTS (SELECT 1 FROM company_payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.company_payment_id = cp.id AND i.branch_id = ANY($4))`];
    if (isUuid(q.company_id)) { params.push(q.company_id); where.push(`cp.company_id = $${params.length}`); }
    return { r, params, where: where.join(' AND ') };
  }

  @Roles('manager', 'cashier') @Get('company-payments')
  async payments(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const { r, params, where } = this.paymentFilters(ctx, q);
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(cp.amount) FILTER (WHERE cp.status = 'active'),0)::bigint AS sum FROM company_payments cp WHERE ${where}`, params))!;
    const rows = await this.db.rows(
      `SELECT cp.id, cp.number, cp.amount, cp.document_number, cp.document_date, cp.note, cp.received_at, cp.created_by_name, cp.status, cp.void_reason, cp.voided_by_name, cp.voided_at,
              co.id AS company_id, co.name AS company_name,
              (SELECT json_agg(json_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'amount', a.amount) ORDER BY i.invoice_number)
                 FROM company_payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.company_payment_id = cp.id) AS allocations
         FROM company_payments cp JOIN companies co ON co.id = cp.company_id WHERE ${where}
        ORDER BY cp.received_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, offset]);
    return { data: rows, meta: { from: r.from, to: r.to, page, page_size: pageSize, total: agg.n, sum: Number(agg.sum) } };
  }

  @Roles('manager') @Post('company-payments/:id/void') @HttpCode(200)
  async void(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(companyPaymentVoidSchema, body);
    return this.db.tx(async (c) => ({ data: await voidCompanyPayment(c, ctx, id, reason) }));
  }

  // ---------------------------------------------------------------- report, statement, act

  private async reportRows(ctx: Ctx, q: any) {
    const r = range(q);
    const P = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    const inv = await this.db.rows(
      `SELECT i.company_id AS id, count(*) FILTER (WHERE i.created_at >= $3 AND i.created_at < $4)::int AS invoices,
              coalesce(sum(i.company_share_amount) FILTER (WHERE i.created_at >= $3 AND i.created_at < $4),0)::bigint AS covered,
              coalesce(sum(${COMPANY_DUE()}),0)::bigint AS outstanding,
              ${Object.values(COMPANY_AGE_BUCKETS).map((w, n) => `coalesce(sum(${COMPANY_DUE()}) FILTER (WHERE ${w}),0)::bigint AS a${n}`).join(', ')},
              coalesce(sum(${COMPANY_DUE()}) FILTER (WHERE ${AGE} > c.payment_terms_days),0)::bigint AS overdue
         FROM invoices i JOIN companies c ON c.id = i.company_id
        WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.company_id IS NOT NULL AND i.status <> 'void' GROUP BY 1`, P);
    const paid = await this.db.rows(
      `SELECT cp.company_id AS id, coalesce(sum(a.amount),0)::bigint AS paid FROM company_payments cp JOIN company_payment_allocations a ON a.company_payment_id = cp.id JOIN invoices i ON i.id = a.invoice_id
        WHERE cp.tenant_id = $1 AND i.branch_id = ANY($2) AND cp.received_at >= $3 AND cp.received_at < $4 AND cp.status = 'active' GROUP BY 1`, P);
    const companies = await this.db.rows(`SELECT ${LIST_COLS} FROM companies c WHERE c.tenant_id = $1 ORDER BY c.name`, [ctx.tenantId]);
    type Row = { company_id: string; name: string; kind: string; inn: string | null; active: boolean; credit_limit: number; payment_terms_days: number; invoices: number; covered: number;
      paid: number; outstanding: number; overdue: number; ageing: Record<'0-30' | '31-60' | '61+', number>; over_limit: boolean };
    const rows: Row[] = [];
    for (const c of companies) {
      const x = inv.find((v) => v.id === c.id), pd = paid.find((v) => v.id === c.id);
      if (!c.active && !x && !pd) continue;
      const total = await companyOutstanding(this.db.pool, ctx.tenantId, c.id); // the credit limit is the company's, across branches
      rows.push({ company_id: c.id, name: c.name, kind: c.kind, inn: c.inn, active: c.active, credit_limit: Number(c.credit_limit), payment_terms_days: c.payment_terms_days,
        invoices: x?.invoices ?? 0, covered: Number(x?.covered ?? 0), paid: Number(pd?.paid ?? 0), outstanding: Number(x?.outstanding ?? 0), overdue: Number(x?.overdue ?? 0),
        ageing: { '0-30': Number(x?.a0 ?? 0), '31-60': Number(x?.a1 ?? 0), '61+': Number(x?.a2 ?? 0) },
        over_limit: Number(c.credit_limit) > 0 && total > Number(c.credit_limit) });
    }
    rows.sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
    const sum = (f: (x: Row) => number) => rows.reduce((a, x) => a + f(x), 0);
    const totals = { invoices: sum((x) => x.invoices), covered: sum((x) => x.covered), paid: sum((x) => x.paid), outstanding: sum((x) => x.outstanding), overdue: sum((x) => x.overdue),
      ageing: { '0-30': sum((x) => x.ageing['0-30']), '31-60': sum((x) => x.ageing['31-60']), '61+': sum((x) => x.ageing['61+']) } };
    return { r, rows, totals };
  }

  /** Receivables of every company: covered in the period, paid in it, outstanding now with ageing, credit-limit warning. */
  @Roles('manager') @Get('reports/companies')
  async report(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { r, rows, totals } = await this.reportRows(ctx, q);
    return { data: rows, meta: { from: r.from, to: r.to, totals } };
  }

  @Roles('manager') @Get('reports/companies/export.csv')
  async reportCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const { rows, totals } = await this.reportRows(ctx, q);
    sendCsv(res, `meduzai-kompaniyalar-${period.from}-${period.to}.csv`,
      ['Kompaniya', 'Turi', 'STIR', 'Hisoblar', 'Kompaniya ulushi (so‘m)', 'To‘langan (so‘m)', 'Qoldiq (so‘m)', '0–30 kun (so‘m)', '31–60 kun (so‘m)', '61+ kun (so‘m)', 'Muddati o‘tgan (so‘m)', 'Kredit limiti (so‘m)', 'Limitdan oshgan'],
      [...rows.map((x) => [x.name, COMPANY_KIND_LABEL[x.kind as CompanyKind] ?? x.kind, x.inn, x.invoices, csvSom(x.covered), csvSom(x.paid), csvSom(x.outstanding),
          csvSom(x.ageing['0-30']), csvSom(x.ageing['31-60']), csvSom(x.ageing['61+']), csvSom(x.overdue), x.credit_limit ? csvSom(x.credit_limit) : '', x.over_limit ? 'ha' : '']),
        ['Jami', `${rows.length} ta kompaniya`, '', totals.invoices, csvSom(totals.covered), csvSom(totals.paid), csvSom(totals.outstanding),
          csvSom(totals.ageing['0-30']), csvSom(totals.ageing['31-60']), csvSom(totals.ageing['61+']), csvSom(totals.overdue), '', '']]);
  }

  /**
   * Statement / reconciliation act of one company for a period: opening balance, the company's part of bills issued in
   * the period (debit), its payments received in the period (credit), closing balance. A voided payment is left out
   * altogether (it was a mistake); the bills of the person's branches only.
   */
  private async statementData(ctx: Ctx, id: string, q: any) {
    const r = range(q);
    const c = await this.load(this.db.pool, ctx, id);
    const P = [ctx.tenantId, id, ctx.branchIds, r.start, r.end];
    const before = (await this.db.one(
      `SELECT (coalesce((SELECT sum(i.company_share_amount) FROM invoices i WHERE i.tenant_id = $1 AND i.company_id = $2 AND i.branch_id = ANY($3) AND i.status <> 'void' AND i.created_at < $4),0)
             - coalesce((SELECT sum(a.amount) FROM company_payments cp JOIN company_payment_allocations a ON a.company_payment_id = cp.id JOIN invoices i ON i.id = a.invoice_id
                          WHERE cp.tenant_id = $1 AND cp.company_id = $2 AND i.branch_id = ANY($3) AND cp.status = 'active' AND cp.received_at < $4),0))::bigint AS opening`, P.slice(0, 4)))!;
    const invoices = await this.db.rows(
      `SELECT i.id, i.invoice_number, i.created_at, i.total, i.company_percent, i.company_share_amount AS amount, i.company_paid_amount, i.company_member_no,
              p.patient_number, p.last_name, p.first_name, ${'(SELECT string_agg(it.description, \', \' ORDER BY it.position) FROM invoice_items it WHERE it.invoice_id = i.id)'} AS services
         FROM invoices i JOIN patients p ON p.id = i.patient_id
        WHERE i.tenant_id = $1 AND i.company_id = $2 AND i.branch_id = ANY($3) AND i.status <> 'void' AND i.company_share_amount > 0 AND i.created_at >= $4 AND i.created_at < $5
        ORDER BY i.created_at LIMIT 2000`, P);
    const payments = await this.db.rows(
      `SELECT cp.id, cp.number, cp.received_at, cp.document_number, cp.document_date, sum(a.amount)::bigint AS amount
         FROM company_payments cp JOIN company_payment_allocations a ON a.company_payment_id = cp.id JOIN invoices i ON i.id = a.invoice_id
        WHERE cp.tenant_id = $1 AND cp.company_id = $2 AND i.branch_id = ANY($3) AND cp.status = 'active' AND cp.received_at >= $4 AND cp.received_at < $5
        GROUP BY cp.id ORDER BY cp.received_at LIMIT 2000`, P);
    const opening = Number(before.opening);
    const debit = invoices.reduce((a, x) => a + Number(x.amount), 0), credit = payments.reduce((a, x) => a + Number(x.amount), 0);
    const clinic = (await this.db.one(`SELECT name FROM tenants WHERE id = $1`, [ctx.tenantId]))!.name;
    return { r, company: c, clinic, opening, debit, credit, closing: opening + debit - credit,
      invoices: invoices.map((x) => ({ ...x, amount: Number(x.amount) })), payments: payments.map((x) => ({ ...x, amount: Number(x.amount) })) };
  }

  @Roles('manager') @Get('companies/:id/statement')
  async statement(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any) {
    const s = await this.statementData(ctx, id, q);
    const { r, ...rest } = s;
    return { data: { ...rest, from: r.from, to: r.to } };
  }

  @Roles('manager') @Get('companies/:id/statement.csv')
  async statementCsv(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const s = await this.statementData(ctx, id, q);
    const lines: unknown[][] = [
      ['', 'Davr boshiga qoldiq', '', '', '', csvSom(s.opening)],
      ...s.invoices.map((x) => [csvTime(x.created_at), `Hisob №${x.invoice_number}`, x.company_member_no ?? '', x.services ?? '', csvSom(x.amount), '']),
      ...s.payments.map((x) => [csvTime(x.received_at), `To‘lov №${x.number}`, x.document_number ?? '', csvDate(x.document_date), '', csvSom(x.amount)]),
      ['Jami', `${s.invoices.length} ta hisob, ${s.payments.length} ta to‘lov`, '', '', csvSom(s.debit), csvSom(s.credit)],
      ['', 'Davr oxiriga qoldiq', '', '', '', csvSom(s.closing)],
    ];
    sendCsv(res, `meduzai-kompaniya-${s.company.inn ?? 'akt'}-${period.from}-${period.to}.csv`, ['Sana (Toshkent)', 'Hujjat', 'Polis / xodim №', 'Xizmatlar / to‘lov sanasi', 'Hisoblandi (so‘m)', 'To‘landi (so‘m)'], lines);
  }
}
