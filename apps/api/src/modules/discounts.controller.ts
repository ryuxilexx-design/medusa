// «Chegirmalar»: discount rules, benefit categories, applying a rule to a bill and the discounts report
// (docs/DISCOUNTS_COMPANIES.md, migration 043).
// Roles: the manager configures everything and sees the report. Registrar and cashier read the active rules and
// categories (the picker) and apply a rule within its staff maximum. Doctor, lab, storekeeper, guard: 403.
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { applyDiscountSchema, benefitCategorySchema, discountRuleSchema, DISCOUNT_SOURCE_LABEL, translate } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { today } from '../core/clock';
import { branchScope } from '../core/scope';
import { csvPeriod, csvSom, sendCsv } from '../core/csv';
import { range } from './dashboard.controller';
import { applyDiscount, RULE_COLS, RULE_USABLE } from './discounts';

const msg = (k: Parameters<typeof translate>[1]) => translate('uz', k);
const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/ /g, ' ');
export const DISCOUNT_GROUPS = ['rule', 'category', 'staff', 'service'] as const;
type Group = (typeof DISCOUNT_GROUPS)[number];

/** Discounted lines of non-void bills created in [$3, $4) (aliases it, i, o). Every grouping sums the same lines. */
const LINES_WHERE = `i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.created_at >= $3 AND i.created_at < $4 AND i.status <> 'void' AND it.discount_share > 0`;
const GROUP_SQL: Record<Group, { key: string; label: string; join?: string }> = {
  // the rule's name as it was on the bill; the manager's older invoice-level discount has none
  rule: { key: `coalesce(i.discount_rule_id::text, 'manual')`, label: `coalesce(min(i.discount_rule_name), '')` },
  category: { key: `coalesce(i.discount_benefit_category_id::text, 'none')`, label: `coalesce(min(bc.name), '')`, join: `LEFT JOIN benefit_categories bc ON bc.id = i.discount_benefit_category_id` },
  staff: { key: `coalesce(i.discount_granted_by_name, i.discount_approved_by_name, '—')`, label: `coalesce(i.discount_granted_by_name, i.discount_approved_by_name, '—')` },
  service: { key: `o.service_id::text`, label: `min(o.service_name)` },
};

@Controller()
export class DiscountsController {
  constructor(private db: Db) {}

  // ---------------------------------------------------------------- rules

  /** The manager sees every rule (`all=1` with inactive ones); reception and the cashier only the rules usable today. */
  @Roles('manager', 'cashier', 'registrar') @Get('discount-rules')
  async rules(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const all = ctx.role === 'manager' && q.all === '1';
    const rows = await this.db.rows(`SELECT ${RULE_COLS} FROM discount_rules r WHERE r.tenant_id = $1 ${all ? '' : `AND ${RULE_USABLE(2)}`} ORDER BY r.active DESC, r.name LIMIT 200`,
      all ? [ctx.tenantId] : [ctx.tenantId, today()]);
    return { data: rows };
  }

  @Roles('manager') @Post('discount-rules') @HttpCode(201)
  async createRule(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(discountRuleSchema, body);
    return this.db.tx(async (c) => {
      await this.checkServices(c, ctx, input.service_ids);
      const row = (await c.query(
        `INSERT INTO discount_rules (tenant_id, name, kind, percent, amount, staff_max_percent, staff_max_amount, scope, categories, service_ids, valid_from, valid_to, active, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, demo_now(), demo_now()) RETURNING id`, this.ruleParams(ctx, input))).rows[0];
      await audit(c, ctx, 'discount_rule.create', 'discount_rule', row.id, `Chegirma qoidasi: «${input.name}» ${input.kind === 'percent' ? input.percent + '%' : som(input.amount ?? 0) + ' so‘m'}`);
      return { data: row };
    });
  }

  @Roles('manager') @Patch('discount-rules/:id')
  async updateRule(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(discountRuleSchema, body);
    return this.db.tx(async (c) => {
      if (!isUuid(id) || !(await c.query(`SELECT 1 FROM discount_rules WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rowCount) throw notFound('Chegirma qoidasi');
      await this.checkServices(c, ctx, input.service_ids);
      const p = this.ruleParams(ctx, input);
      // past bills keep their snapshot (rule name, value, scope): an edit only changes what is applied from now on
      await c.query(`UPDATE discount_rules SET name = $2, kind = $3, percent = $4, amount = $5, staff_max_percent = $6, staff_max_amount = $7, scope = $8, categories = $9,
          service_ids = $10, valid_from = $11, valid_to = $12, active = $13, updated_at = demo_now() WHERE id = $1`, [id, ...p.slice(1, 13)]);
      await audit(c, ctx, 'discount_rule.update', 'discount_rule', id, `Chegirma qoidasi o‘zgardi: «${input.name}»${input.active === false ? ' (o‘chirildi)' : ''}`);
      return { data: { ok: true } };
    });
  }

  private ruleParams(ctx: Ctx, i: ReturnType<typeof discountRuleSchema.parse>) {
    const pct = i.kind === 'percent';
    return [ctx.tenantId, i.name, i.kind, pct ? i.percent : null, pct ? null : i.amount, pct ? i.staff_max_percent ?? 0 : null, pct ? null : i.staff_max_amount ?? 0,
      i.scope, i.scope === 'categories' ? i.categories : [], i.scope === 'services' ? i.service_ids : [], i.valid_from, i.valid_to, i.active ?? true, ctx.membershipId || null];
  }
  private async checkServices(c: Q, ctx: Ctx, ids: string[]) {
    if (!ids.length) return;
    const n = (await c.query(`SELECT count(*)::int AS n FROM services WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [ctx.tenantId, [...new Set(ids)]])).rows[0].n;
    if (n !== new Set(ids).size) throw invalid({ service_ids: msg('api.disc.badService') });
  }

  // ---------------------------------------------------------------- benefit categories

  @Roles('manager', 'cashier', 'registrar') @Get('benefit-categories')
  async categories(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const all = ctx.role === 'manager' && q.all === '1';
    const rows = await this.db.rows(
      `SELECT b.id, b.name, b.discount_rule_id, r.name AS discount_rule_name, b.requires_document, b.document_label, b.active
         FROM benefit_categories b LEFT JOIN discount_rules r ON r.id = b.discount_rule_id
        WHERE b.tenant_id = $1 ${all ? '' : 'AND b.active'} ORDER BY b.active DESC, b.name LIMIT 200`, [ctx.tenantId]);
    return { data: rows };
  }

  @Roles('manager') @Post('benefit-categories') @HttpCode(201)
  async createCategory(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(benefitCategorySchema, body);
    return this.db.tx(async (c) => {
      await this.checkRule(c, ctx, input.discount_rule_id);
      const row = (await c.query(
        `INSERT INTO benefit_categories (tenant_id, name, discount_rule_id, requires_document, document_label, active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6, demo_now(), demo_now()) RETURNING id`,
        [ctx.tenantId, input.name, input.discount_rule_id ?? null, input.requires_document, input.document_label, input.active ?? true])).rows[0];
      await audit(c, ctx, 'benefit_category.create', 'benefit_category', row.id, `Imtiyoz toifasi: «${input.name}»`);
      return { data: row };
    });
  }

  @Roles('manager') @Patch('benefit-categories/:id')
  async updateCategory(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(benefitCategorySchema, body);
    return this.db.tx(async (c) => {
      if (!isUuid(id) || !(await c.query(`SELECT 1 FROM benefit_categories WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rowCount) throw notFound('Imtiyoz toifasi');
      await this.checkRule(c, ctx, input.discount_rule_id);
      await c.query(`UPDATE benefit_categories SET name = $2, discount_rule_id = $3, requires_document = $4, document_label = $5, active = $6, updated_at = demo_now() WHERE id = $1`,
        [id, input.name, input.discount_rule_id ?? null, input.requires_document, input.document_label, input.active ?? true]);
      await audit(c, ctx, 'benefit_category.update', 'benefit_category', id, `Imtiyoz toifasi o‘zgardi: «${input.name}»`);
      return { data: { ok: true } };
    });
  }

  private async checkRule(c: Q, ctx: Ctx, id: string | null | undefined) {
    if (id && !(await c.query(`SELECT 1 FROM discount_rules WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])).rowCount) throw invalid({ discount_rule_id: msg('api.disc.ruleNotFound') });
  }

  // ---------------------------------------------------------------- on a bill

  /** Applies (or removes) a rule on an open bill. Above the rule's staff maximum: manager only (403), with a reason. */
  @Roles('manager', 'cashier', 'registrar') @Post('invoices/:id/apply-discount') @HttpCode(200)
  async apply(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(applyDiscountSchema, body);
    return this.db.tx(async (c) => ({ data: await applyDiscount(c, ctx, id, input) }));
  }

  // ---------------------------------------------------------------- report

  private async reportRows(ctx: Ctx, q: any) {
    const r = range(q);
    const group: Group = (DISCOUNT_GROUPS as readonly string[]).includes(q.group) ? q.group : 'rule';
    const g = GROUP_SQL[group];
    const P = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    const rows = (await this.db.rows(
      `SELECT ${g.key} AS key, ${g.label} AS label, count(DISTINCT i.id)::int AS invoices, sum(it.quantity)::int AS services,
              sum(it.line_subtotal)::bigint AS gross, sum(it.discount_share)::bigint AS discount, sum(it.line_total)::bigint AS net
         FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id JOIN service_orders o ON o.id = it.order_id ${g.join ?? ''}
        WHERE ${LINES_WHERE} GROUP BY 1 ${group === 'staff' ? ', 2' : ''} ORDER BY discount DESC, label LIMIT 500`, P))
      .map((x) => ({ ...x, gross: Number(x.gross), discount: Number(x.discount), net: Number(x.net) }));
    const totals = (await this.db.one(`SELECT count(DISTINCT i.id)::int AS invoices, coalesce(sum(it.quantity),0)::int AS services, coalesce(sum(it.line_subtotal),0)::bigint AS gross,
        coalesce(sum(it.discount_share),0)::bigint AS discount, coalesce(sum(it.line_total),0)::bigint AS net
        FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id WHERE ${LINES_WHERE}`, P))!;
    return { r, group, rows, totals: { invoices: totals.invoices, services: totals.services, gross: Number(totals.gross), discount: Number(totals.discount), net: Number(totals.net) } };
  }

  /** «Chegirmalar» for a period (bills created in it): by rule, benefit category, who granted it or service — gross, discount, net. */
  @Roles('manager') @Get('reports/discounts')
  async report(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { r, group, rows, totals } = await this.reportRows(ctx, q);
    return { data: rows, meta: { from: r.from, to: r.to, group, totals } };
  }

  @Roles('manager') @Get('reports/discounts/export.csv')
  async reportCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const { group, rows, totals } = await this.reportRows(ctx, q);
    const head: Record<Group, string> = { rule: 'Chegirma qoidasi', category: 'Imtiyoz toifasi', staff: 'Kim berdi', service: 'Xizmat' };
    const label = (x: any) => x.label || (group === 'rule' ? DISCOUNT_SOURCE_LABEL.manual : group === 'category' ? 'Toifasiz' : '—');
    sendCsv(res, `meduzai-chegirmalar-${group}-${period.from}-${period.to}.csv`,
      [head[group], 'Hisoblar', 'Xizmatlar', 'Summa (so‘m)', 'Chegirma (so‘m)', 'To‘lanadigan (so‘m)'],
      [...rows.map((x) => [label(x), x.invoices, x.services, csvSom(x.gross), csvSom(x.discount), csvSom(x.net)]),
        ['Jami', totals.invoices, totals.services, csvSom(totals.gross), csvSom(totals.discount), csvSom(totals.net)]]);
  }
}

