import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { clinicPatchSchema, servicePatchSchema } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { notFound, invalid } from '../core/errors';
import { isDate, isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { availability } from './booking';
import { addDays, fromMinutes, localToUtc, now, toMinutes, weekday, localTime, localDate } from '../core/clock';

export const PRICE_SQL = `(SELECT sp.amount FROM service_prices sp WHERE sp.service_id = s.id AND (sp.branch_id IS NULL OR sp.branch_id = $BRANCH)
   AND sp.valid_from <= demo_now() ORDER BY (sp.branch_id IS NULL), sp.valid_from DESC LIMIT 1)`;

@Controller()
export class ReferenceController {
  constructor(private db: Db) {}

  @Get('branches')
  async branches(@CurrentCtx() ctx: Ctx) {
    return { data: await this.db.rows(`SELECT id, name, code, address, timezone FROM branches WHERE tenant_id = $1 ORDER BY code`, [ctx.tenantId]) };
  }

  @Get('rooms')
  async rooms(@CurrentCtx() ctx: Ctx) {
    return { data: await this.db.rows(`SELECT r.id, r.name, r.purpose, r.branch_id, b.name AS branch_name FROM rooms r JOIN branches b ON b.id = r.branch_id WHERE r.tenant_id = $1 ORDER BY r.name`, [ctx.tenantId]) };
  }

  @Get('doctors')
  async doctors(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const params: unknown[] = [ctx.tenantId];
    let where = 'd.tenant_id = $1 AND d.active';
    if (isUuid(q.service_id)) { params.push(q.service_id); where += ` AND EXISTS (SELECT 1 FROM doctor_services ds WHERE ds.doctor_id = d.id AND ds.service_id = $${params.length})`; }
    const rows = await this.db.rows(
      `SELECT d.id, d.display_name, d.specialty, ${ctx.role === 'manager' ? 'd.default_share_percent' : 'NULL::numeric AS default_share_percent'},
              (SELECT json_agg(json_build_object('weekday', s.weekday, 'branch_id', s.branch_id, 'start', to_char(s.start_time,'HH24:MI'), 'end', to_char(s.end_time,'HH24:MI'),
                       'break_start', to_char(s.break_start,'HH24:MI'), 'break_end', to_char(s.break_end,'HH24:MI'), 'room', r.name) ORDER BY s.weekday)
                 FROM schedules s LEFT JOIN rooms r ON r.id = s.room_id WHERE s.doctor_id = d.id) AS schedule,
              (SELECT array_agg(ds.service_id) FROM doctor_services ds WHERE ds.doctor_id = d.id) AS service_ids
         FROM doctors d WHERE ${where} ORDER BY d.display_name`, params);
    return { data: rows };
  }

  @Get('services')
  async services(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const params: unknown[] = [ctx.tenantId];
    let where = 's.tenant_id = $1';
    if (q.category) { params.push(String(q.category)); where += ` AND s.category = $${params.length}`; }
    if (q.active !== 'all') where += ' AND s.active';
    const rows = await this.db.rows(
      `SELECT s.id, s.code, s.name, s.category, s.duration_min, ${ctx.role === 'manager' ? 's.share_percent' : 'NULL::numeric AS share_percent'}, s.active, s.lab_template,
              ${PRICE_SQL.replace('$BRANCH', 'NULL')} AS price,
              EXISTS (SELECT 1 FROM service_orders o WHERE o.service_id = s.id) AS used
         FROM services s WHERE ${where} ORDER BY s.code`, params);
    return { data: rows };
  }

  @Roles('manager') @Patch('services/:id')
  async patchService(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(servicePatchSchema, body);
    if (!isUuid(id)) throw notFound('Xizmat');
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT * FROM services WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!s) throw notFound('Xizmat');
      const changes: string[] = [];
      if (input.name !== undefined && input.name !== s.name) changes.push(`nomi: «${input.name}»`);
      if (input.duration_min !== undefined && input.duration_min !== s.duration_min) changes.push(`davomiylik: ${input.duration_min} daq.`);
      if (input.active !== undefined && input.active !== s.active) changes.push(input.active ? 'faol qilindi' : 'nofaol qilindi');
      await c.query(`UPDATE services SET name = COALESCE($2, name), duration_min = COALESCE($3, duration_min), active = COALESCE($4, active), updated_at = demo_now() WHERE id = $1`,
        [id, input.name ?? null, input.duration_min ?? null, input.active ?? null]);
      if (input.price !== undefined) {
        const cur = (await c.query(`SELECT ${PRICE_SQL.replace('$BRANCH', 'NULL')} AS price FROM services s WHERE s.id = $1`, [id])).rows[0].price;
        if (cur !== input.price) {
          // new price applies to future orders; existing orders keep their price snapshot
          await c.query(`INSERT INTO service_prices (tenant_id, service_id, branch_id, amount, valid_from) VALUES ($1,$2,NULL,$3, demo_now())`, [ctx.tenantId, id, input.price]);
          changes.push(`narx: ${(cur / 100).toLocaleString('ru-RU')} → ${(input.price / 100).toLocaleString('ru-RU')} so‘m`);
        }
      }
      if (changes.length) await audit(c, ctx, 'service.update', 'service', id, `${s.name}: ${changes.join(', ')}`);
      return { data: { ok: true, changes } };
    });
  }

  @Get('settings')
  async settings(@CurrentCtx() ctx: Ctx) {
    const t = await this.db.one(`SELECT id, name FROM tenants WHERE id = $1`, [ctx.tenantId]);
    return { data: t };
  }

  @Roles('manager') @Patch('settings/clinic')
  async patchClinic(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { name } = parse(clinicPatchSchema, body);
    await this.db.tx(async (c) => {
      await c.query(`UPDATE tenants SET name = $2, updated_at = demo_now() WHERE id = $1`, [ctx.tenantId, name]);
      await audit(c, ctx, 'settings.update', 'tenant', ctx.tenantId, `Klinika nomi: «${name}»`);
    });
    return { data: { ok: true } };
  }

  /** Free start times for a doctor/service on a local date, respecting schedule, break and existing bookings. */
  @Roles('manager', 'registrar', 'doctor') @Get('availability')
  async availability(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    if (!isUuid(q.doctor_id) || !isDate(q.date)) throw invalid({ doctor_id: 'Shifokor va sanani tanlang' });
    const doctor = await this.db.one(`SELECT id FROM doctors WHERE id = $1 AND tenant_id = $2`, [q.doctor_id, ctx.tenantId]);
    if (!doctor) throw notFound('Shifokor');
    let duration = 30;
    if (q.duration_min !== undefined && q.duration_min !== '') {
      const d = Number(q.duration_min);
      if (!Number.isInteger(d) || d < 5 || d > 480) throw invalid({ duration_min: 'Davomiylik 5–480 daqiqa bo‘lsin' });
      duration = d;
    }
    if (isUuid(q.service_id)) {
      const s = await this.db.one(`SELECT duration_min FROM services WHERE id = $1 AND tenant_id = $2`, [q.service_id, ctx.tenantId]);
      if (s && !q.duration_min) duration = s.duration_min;
    }
    const exclude = isUuid(q.exclude_appointment_id) ? q.exclude_appointment_id : null;
    return { data: await availability(this.db.pool, ctx.tenantId, q.doctor_id, q.date, duration, exclude) };
  }
}
