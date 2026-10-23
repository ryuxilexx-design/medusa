// Less typing for the doctor: note templates per specialty and quick phrases. Both are interface text of the clinic,
// not patient data — doctors and managers read them, every other role gets 403. A template only fills the note on the
// screen; ICD codes are re-checked when the note is saved and the proposed orders go through POST /encounters/:id/orders.
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { noteTemplateSchema, noteTemplateUpdateSchema, quickPhraseSchema } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { forbidden, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { now } from '../core/clock';
import { Icd10Service } from '../ai/icd10';

const TEMPLATE_SQL = `
  SELECT t.id, t.specialty, t.name, t.fields, t.icd_codes, t.order_service_ids, t.created_by, t.starter_key IS NOT NULL AS starter, t.active, t.sort, t.updated_at, u.full_name AS author_name,
         (SELECT coalesce(json_agg(json_build_object('code', c.code, 'title', coalesce(c.title_uz, c.title_ru)) ORDER BY o.i), '[]'::json)
            FROM unnest(t.icd_codes) WITH ORDINALITY AS o(code, i) JOIN icd10_codes c ON c.code = o.code) AS icd,
         (SELECT coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'category', s.category) ORDER BY o.i), '[]'::json)
            FROM unnest(t.order_service_ids) WITH ORDINALITY AS o(id, i) JOIN services s ON s.id = o.id AND s.tenant_id = t.tenant_id AND s.active) AS order_services
    FROM note_templates t LEFT JOIN memberships m ON m.id = t.created_by LEFT JOIN users u ON u.id = m.user_id`;

@Controller('note-templates')
export class NoteTemplatesController {
  constructor(private db: Db, private icd: Icd10Service) {}

  /** Every code must exist in the clinic's MKB-10 list; every proposed order must be an active, orderable service of this clinic. */
  private async check(c: Q, ctx: Ctx, codes: string[] | undefined, serviceIds: string[] | undefined) {
    if (codes && !(await this.icd.snapshot(c, codes))) throw invalid({ icd_codes: 'MKB-10 kodi ro‘yxatda topilmadi' });
    if (serviceIds?.length) {
      const ids = [...new Set(serviceIds)];
      const rows = (await c.query(`SELECT id, category, active FROM services WHERE id = ANY($1) AND tenant_id = $2`, [ids, ctx.tenantId])).rows;
      if (rows.length !== ids.length || rows.some((s: any) => !s.active || s.category === 'consultation')) throw invalid({ order_service_ids: 'Tanlangan tekshiruvlardan biri mavjud emas yoki buyurtma qilinmaydi' });
    }
  }

  /** The doctor may change their own templates; the manager any template of the clinic (starters included). */
  private async load(c: Q, ctx: Ctx, id: string) {
    if (!isUuid(id)) throw notFound('Shablon');
    const t = (await c.query(`SELECT id, name, created_by, active FROM note_templates WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
    if (!t) throw notFound('Shablon');
    if (ctx.role !== 'manager' && t.created_by !== ctx.membershipId) throw forbidden('Faqat o‘z shablonlaringizni o‘zgartira olasiz');
    return t;
  }

  /** Active templates: the doctor's own specialty first, then the clinic-wide ones, then the rest. */
  @Roles('doctor', 'manager') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query('specialty') specialty?: string) {
    const sp = (specialty || ctx.doctorSpecialty || '').trim() || null;
    const rows = await this.db.rows(
      `${TEMPLATE_SQL} WHERE t.tenant_id = $1 AND t.active
        ORDER BY (t.specialty IS NOT DISTINCT FROM $2::text) DESC, (t.specialty IS NULL) DESC, t.specialty NULLS FIRST, t.sort, t.name LIMIT 500`, [ctx.tenantId, sp]);
    return { data: rows.map((r) => ({ ...r, mine: r.created_by === ctx.membershipId })), meta: { specialty: sp } };
  }

  @Roles('doctor', 'manager') @Post()
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(noteTemplateSchema, body);
    return this.db.tx(async (c) => {
      await this.check(c, ctx, input.icd_codes, input.order_service_ids);
      const row = (await c.query(
        `INSERT INTO note_templates (tenant_id, specialty, name, fields, icd_codes, order_service_ids, created_by, sort, created_at, updated_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6::uuid[],$7,$8,$9,$9) RETURNING id`,
        [ctx.tenantId, input.specialty, input.name, JSON.stringify(input.fields), input.icd_codes, input.order_service_ids, ctx.membershipId, input.sort ?? 100, now()])).rows[0];
      // the name only: a template's text is the clinic's reference text, still not something for the audit trail
      await audit(c, ctx, 'note_template.create', 'note_template', row.id, `Qayd shabloni yaratildi: ${input.name}${input.specialty ? ` (${input.specialty})` : ''}`);
      const full = (await c.query(`${TEMPLATE_SQL} WHERE t.id = $1`, [row.id])).rows[0];
      return { data: { ...full, mine: true } };
    });
  }

  @Roles('doctor', 'manager') @Patch(':id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(noteTemplateUpdateSchema, body);
    return this.db.tx(async (c) => {
      const t = await this.load(c, ctx, id);
      await this.check(c, ctx, input.icd_codes, input.order_service_ids);
      await c.query(
        `UPDATE note_templates SET name = coalesce($2, name), specialty = CASE WHEN $3::boolean THEN $4 ELSE specialty END, fields = coalesce($5::jsonb, fields),
                icd_codes = coalesce($6, icd_codes), order_service_ids = coalesce($7::uuid[], order_service_ids), sort = coalesce($8, sort), active = coalesce($9, active), updated_at = $10
          WHERE id = $1`,
        [id, input.name ?? null, body != null && typeof body === 'object' && 'specialty' in (body as object), input.specialty ?? null, input.fields ? JSON.stringify(input.fields) : null,
          input.icd_codes ?? null, input.order_service_ids ?? null, input.sort ?? null, input.active ?? null, now()]);
      await audit(c, ctx, 'note_template.update', 'note_template', id, `Qayd shabloni o‘zgartirildi: ${input.name ?? t.name}`);
      const full = (await c.query(`${TEMPLATE_SQL} WHERE t.id = $1`, [id])).rows[0];
      return { data: { ...full, mine: full.created_by === ctx.membershipId } };
    });
  }

  /** Hides the template (active = false): notes written from it are not affected, the row stays. */
  @Roles('doctor', 'manager') @Delete(':id') @HttpCode(200)
  async remove(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const t = await this.load(c, ctx, id);
      await c.query(`UPDATE note_templates SET active = false, updated_at = $2 WHERE id = $1`, [id, now()]);
      await audit(c, ctx, 'note_template.delete', 'note_template', id, `Qayd shabloni yashirildi: ${t.name}`);
      return { data: { ok: true } };
    });
  }
}

const OWNER = (ctx: Ctx) => (ctx.role === 'doctor' ? ctx.doctorId : null);

@Controller('quick-phrases')
export class QuickPhrasesController {
  constructor(private db: Db) {}

  /** The doctor's own phrases and the clinic's shared ones for one field (or all), most used first. */
  @Roles('doctor', 'manager') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query('field') field?: string) {
    const rows = await this.db.rows(
      `SELECT id, field, text, uses, doctor_id IS NULL AS shared FROM quick_phrases
        WHERE tenant_id = $1 AND (doctor_id IS NULL OR doctor_id = $2) AND ($3::text IS NULL OR field = $3)
        ORDER BY uses DESC, created_at DESC, text LIMIT 200`, [ctx.tenantId, OWNER(ctx), field || null]);
    return { data: rows };
  }

  /** Saves a phrase (the doctor's own; the manager saves the clinic's shared ones). The same text twice is one row. */
  @Roles('doctor', 'manager') @Post()
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(quickPhraseSchema, body);
    const shared = ctx.role === 'manager' || !!input.shared;
    if (shared && ctx.role !== 'manager') throw forbidden('Umumiy iborani faqat rahbar qo‘shadi');
    const owner = shared ? null : ctx.doctorId;
    const row = (await this.db.pool.query(
      `INSERT INTO quick_phrases (tenant_id, doctor_id, field, text, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid), field, text) DO UPDATE SET uses = quick_phrases.uses
       RETURNING id, field, text, uses, doctor_id IS NULL AS shared, (xmax = 0) AS created`, [ctx.tenantId, owner, input.field, input.text, now()])).rows[0];
    return { data: row };
  }

  /** One tap on a chip: the counter decides the order of the chips. */
  @Roles('doctor', 'manager') @Post(':id/use') @HttpCode(200)
  async use(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Ibora');
    const r = await this.db.one(`UPDATE quick_phrases SET uses = uses + 1 WHERE id = $1 AND tenant_id = $2 AND (doctor_id IS NULL OR doctor_id = $3) RETURNING id, uses`, [id, ctx.tenantId, OWNER(ctx)]);
    if (!r) throw notFound('Ibora');
    return { data: r };
  }

  /** The doctor removes their own phrase; the manager a shared one. */
  @Roles('doctor', 'manager') @Delete(':id') @HttpCode(200)
  async remove(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Ibora');
    const p = await this.db.one(`SELECT doctor_id FROM quick_phrases WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
    if (!p) throw notFound('Ibora');
    if (ctx.role === 'manager' ? p.doctor_id !== null : p.doctor_id !== ctx.doctorId) throw forbidden('Faqat o‘z iboralaringizni o‘chira olasiz');
    await this.db.pool.query(`DELETE FROM quick_phrases WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
    return { data: { ok: true } };
  }
}
