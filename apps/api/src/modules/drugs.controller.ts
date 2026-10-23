import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { allergyCreateSchema, allergyWithdrawSchema, searchTranslit } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { coded, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { assertPatientAccess } from './patients.controller';

const DRUG_COLS = `id, inn, inn_ru, atc, forms, allergy_classes, prescription_only`;
const like = (v: string) => `%${v.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;

/** Drug reference (migration 028): generic names only; the doctor picks one in the prescription. */
@Roles('doctor')
@Controller()
export class DrugsController {
  constructor(private db: Db) {}

  /** Trigram search over INN (Latin) and the Russian name; a name typed in the other script is found too. ATC prefix works. */
  @Get('drugs')
  async search(@Query('q') raw?: string) {
    const q = String(raw ?? '').trim().slice(0, 60);
    if (q.length < 2) return { data: [] };
    const params: unknown[] = [like(q)];
    const conds = [`lower(inn || ' ' || inn_ru) LIKE $1`];
    const other = searchTranslit(q);
    if (other) { params.push(like(other)); conds.push(`lower(inn || ' ' || inn_ru) LIKE $${params.length}`); }
    if (/^[A-Za-z]\d{2}[A-Za-z0-9]{0,4}$/.test(q)) { params.push(q.toUpperCase() + '%'); conds.push(`atc LIKE $${params.length}`); }
    params.push(q.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%');
    const prefix = params.length;
    return { data: await this.db.rows(
      `SELECT ${DRUG_COLS} FROM drugs WHERE active AND (${conds.join(' OR ')})
        ORDER BY (lower(inn) LIKE $${prefix} OR lower(inn_ru) LIKE $${prefix}) DESC, length(inn), inn LIMIT 20`, params) };
  }

  @Get('allergy-classes')
  async classes() {
    return { data: await this.db.rows(`SELECT code, name_uz, name_ru, cross_reactive FROM allergy_classes ORDER BY sort, code`) };
  }
}

/**
 * The patient's structured allergy list: append, confirm (once) and withdraw (once) — never edited or deleted (DB trigger).
 * Doctors read and record (treating-doctor rule: an appointment with the patient). Reception may record only what the
 * patient said, as text (source «intake», shown to the doctor as «not confirmed»); reception never reads the list.
 */
@Controller('patients/:id/allergies')
export class AllergiesController {
  constructor(private db: Db) {}

  @Roles('doctor') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await assertPatientAccess(this.db.pool, ctx, id);
    return { data: await this.db.rows(
      `SELECT a.id, a.class_code, c.name_uz AS class_name_uz, c.name_ru AS class_name_ru, a.drug_id, d.inn AS drug_inn, d.inn_ru AS drug_inn_ru,
              a.free_text, a.reaction, a.severity, a.source, a.recorded_by_name, a.recorded_by_role, a.recorded_at,
              a.confirmed_at, a.confirmed_by_name, a.withdrawn_at, a.withdrawn_by_name, a.withdraw_reason
         FROM patient_allergies a LEFT JOIN allergy_classes c ON c.code = a.class_code LEFT JOIN drugs d ON d.id = a.drug_id
        WHERE a.patient_id = $1 AND a.tenant_id = $2
        ORDER BY (a.withdrawn_at IS NULL) DESC, a.recorded_at DESC LIMIT 200`, [id, ctx.tenantId]) };
  }

  @Roles('doctor', 'registrar') @Post() @HttpCode(201)
  async add(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(allergyCreateSchema, body);
    const doctor = ctx.role === 'doctor';
    if (!doctor && (input.class_code || input.drug_id || !input.free_text)) throw coded(403, 'FORBIDDEN', 'api.allergy.registrarTextOnly');
    return this.db.tx(async (c) => {
      if (doctor) await assertPatientAccess(c, ctx, id);
      else if (!isUuid(id) || !(await c.query(`SELECT 1 FROM patients WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])).rowCount) throw notFound('Bemor');
      // one writer per patient card at a time (the prescription check reads the list under FOR SHARE)
      await c.query(`SELECT 1 FROM patients WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId]);
      if (input.class_code && !(await c.query(`SELECT 1 FROM allergy_classes WHERE code = $1`, [input.class_code])).rowCount) throw invalid({ class_code: 'Noma’lum allergiya sinfi' });
      if (input.drug_id && !(await c.query(`SELECT 1 FROM drugs WHERE id = $1`, [input.drug_id])).rowCount) throw invalid({ drug_id: 'Dori ro‘yxatda topilmadi' });
      const source = doctor ? input.source : 'intake';
      // the same patient-reported text twice (a second click on the intake answer) is the same allergy
      if (source === 'intake' && input.free_text && !input.class_code && !input.drug_id) {
        const same = (await c.query(`SELECT id FROM patient_allergies WHERE tenant_id = $1 AND patient_id = $2 AND withdrawn_at IS NULL AND source = 'intake'
                                      AND class_code IS NULL AND drug_id IS NULL AND lower(free_text) = lower($3) LIMIT 1`, [ctx.tenantId, id, input.free_text])).rows[0];
        if (same) return { data: { id: same.id, existing: true } };
      }
      const row = (await c.query(
        `INSERT INTO patient_allergies (tenant_id, patient_id, class_code, drug_id, free_text, reaction, severity, source, recorded_by, recorded_by_name, recorded_by_role, confirmed_at, confirmed_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $11 = 'doctor' THEN demo_now() END, CASE WHEN $11 = 'doctor' THEN $10 END) RETURNING id`,
        [ctx.tenantId, id, input.class_code ?? null, input.drug_id ?? null, input.free_text, input.reaction, input.severity, source, ctx.membershipId || null, ctx.name, doctor ? 'doctor' : 'registrar'])).rows[0];
      // a doctor-recorded allergy makes the card's allergy status «known» (the old note stays as written)
      if (doctor) await c.query(`UPDATE patients SET allergy_state = 'known' WHERE id = $1 AND tenant_id = $2 AND allergy_state <> 'known'`, [id, ctx.tenantId]);
      await audit(c, ctx, doctor ? 'patient.allergy_add' : 'patient.allergy_reported', 'patient', id, doctor ? 'Allergiya qayd etildi' : 'Bemor aytgan allergiya qayd etildi (shifokor tasdig‘ini kutadi)');
      return { data: { id: row.id, existing: false } };
    });
  }

  @Roles('doctor') @Post(':aid/confirm') @HttpCode(200)
  async confirm(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('aid') aid: string) {
    return this.db.tx(async (c) => {
      await assertPatientAccess(c, ctx, id);
      const a = await this.locked(c, ctx, id, aid);
      if (a.withdrawn_at) throw coded(409, 'ALREADY_WITHDRAWN', 'api.allergy.withdrawn');
      if (a.confirmed_at) throw coded(409, 'ALREADY_CONFIRMED', 'api.allergy.confirmed');
      await c.query(`UPDATE patient_allergies SET confirmed_at = demo_now(), confirmed_by_name = $2 WHERE id = $1`, [aid, ctx.name]);
      await c.query(`UPDATE patients SET allergy_state = 'known' WHERE id = $1 AND tenant_id = $2 AND allergy_state <> 'known'`, [id, ctx.tenantId]);
      await audit(c, ctx, 'patient.allergy_confirm', 'patient', id, 'Bemor aytgan allergiya tasdiqlandi');
      return { data: { ok: true } };
    });
  }

  @Roles('doctor') @Post(':aid/withdraw') @HttpCode(200)
  async withdraw(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const { reason } = parse(allergyWithdrawSchema, body);
    return this.db.tx(async (c) => {
      await assertPatientAccess(c, ctx, id);
      const a = await this.locked(c, ctx, id, aid);
      if (a.withdrawn_at) throw coded(409, 'ALREADY_WITHDRAWN', 'api.allergy.withdrawn');
      await c.query(`UPDATE patient_allergies SET withdrawn_at = demo_now(), withdrawn_by_name = $2, withdraw_reason = $3 WHERE id = $1`, [aid, ctx.name, reason]);
      await audit(c, ctx, 'patient.allergy_withdraw', 'patient', id, 'Allergiya yozuvi bekor qilindi');
      return { data: { ok: true } };
    });
  }

  private async locked(c: Q, ctx: Ctx, id: string, aid: string) {
    if (!isUuid(aid)) throw notFound('Allergiya yozuvi');
    const a = (await c.query(`SELECT id, confirmed_at, withdrawn_at FROM patient_allergies WHERE id = $1 AND patient_id = $2 AND tenant_id = $3 FOR UPDATE`, [aid, id, ctx.tenantId])).rows[0];
    if (!a) throw notFound('Allergiya yozuvi');
    return a;
  }
}
