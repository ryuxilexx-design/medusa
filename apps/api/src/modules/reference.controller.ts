import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { branchCreateSchema, branchPatchSchema, clinicPatchSchema, roomCreateSchema, roomPatchSchema, serviceCreateSchema, servicePatchSchema } from '@meduza/contracts';
import { PoolClient } from 'pg';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { notFound, invalid, conflict } from '../core/errors';
import { isDate, isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { availability } from './booking';

export const PRICE_SQL = `(SELECT sp.amount FROM service_prices sp WHERE sp.service_id = s.id AND (sp.branch_id IS NULL OR sp.branch_id = $BRANCH)
   AND sp.valid_from <= demo_now() ORDER BY (sp.branch_id IS NULL), sp.valid_from DESC LIMIT 1)`;

const CODE_PREFIX: Record<string, string> = { consultation: 'C', lab: 'L', ultrasound: 'U', procedure: 'P' };
const som = (tiyin: number) => (tiyin / 100).toLocaleString('ru-RU');
/** A short branch code from the name's Latin letters (MRK, YUN…), numbered when taken. */
function freeCode(name: string, taken: Set<string>) {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'FIL';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) { const c = `${base}${n}`.slice(-8); if (!taken.has(c)) return c; }
}

@Controller()
export class ReferenceController {
  constructor(private db: Db) {}

  /** Active branches of the clinic (`?active=all` adds the switched-off ones — the manager's settings screen). */
  @Get('branches')
  async branches(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const all = q.active === 'all' && ctx.role === 'manager';
    return { data: await this.db.rows(`SELECT id, name, code, address, phone, timezone, active FROM branches WHERE tenant_id = $1 ${all ? '' : 'AND active'} ORDER BY active DESC, code LIMIT 200`, [ctx.tenantId]) };
  }

  @Roles('manager') @Post('branches')
  async createBranch(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(branchCreateSchema, body);
    return this.db.tx(async (c) => {
      await c.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [ctx.tenantId]); // one branch code generator per clinic at a time
      const taken = new Set((await c.query(`SELECT code FROM branches WHERE tenant_id = $1`, [ctx.tenantId])).rows.map((r) => r.code as string));
      let code = input.code;
      if (code) { if (taken.has(code)) throw conflict('DUPLICATE', 'Bu kodli filial allaqachon bor'); }
      else code = freeCode(input.name, taken);
      const id = (await c.query(
        `INSERT INTO branches (id, tenant_id, name, code, address, phone, timezone, active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'Asia/Tashkent', $6, demo_now(), demo_now()) RETURNING id`,
        [ctx.tenantId, input.name, code, input.address ?? null, input.phone ?? null, input.active])).rows[0].id as string;
      // the manager who opens a branch works in it: otherwise it would stay invisible in the header's branch list
      await c.query(`UPDATE memberships SET branch_ids = array_append(branch_ids, $2) WHERE id = $1 AND NOT ($2 = ANY(branch_ids))`, [ctx.membershipId, id]);
      await audit(c, ctx, 'branch.create', 'branch', id, `Filial qo‘shildi: «${input.name}» (${code})`, id);
      return { data: { id, code } };
    });
  }

  @Roles('manager') @Patch('branches/:id')
  async patchBranch(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(branchPatchSchema, body);
    if (!isUuid(id)) throw notFound('Filial');
    return this.db.tx(async (c) => {
      const b = (await c.query(`SELECT * FROM branches WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!b) throw notFound('Filial');
      const changes: string[] = [];
      if (input.name !== undefined && input.name !== b.name) changes.push(`nomi: «${input.name}»`);
      if (input.address !== undefined && input.address !== b.address) changes.push('manzil');
      if (input.phone !== undefined && input.phone !== b.phone) changes.push('telefon');
      if (input.active !== undefined && input.active !== b.active) {
        if (!input.active) {
          const others = (await c.query(`SELECT count(*)::int AS n FROM branches WHERE tenant_id = $1 AND active AND id <> $2`, [ctx.tenantId, id])).rows[0].n;
          if (!others) throw invalid({ active: 'Oxirgi faol filialni o‘chirib bo‘lmaydi' });
        }
        changes.push(input.active ? 'faol qilindi' : 'nofaol qilindi');
      }
      await c.query(`UPDATE branches SET name = COALESCE($2, name), address = CASE WHEN $3::boolean THEN $4 ELSE address END, phone = CASE WHEN $5::boolean THEN $6 ELSE phone END,
                       active = COALESCE($7, active), updated_at = demo_now() WHERE id = $1`,
        [id, input.name ?? null, input.address !== undefined, input.address ?? null, input.phone !== undefined, input.phone ?? null, input.active ?? null]);
      if (changes.length) await audit(c, ctx, 'branch.update', 'branch', id, `${b.name}: ${changes.join(', ')}`, id);
      return { data: { ok: true, changes } };
    });
  }

  /** Rooms of the clinic's branches; `?active=all` adds the switched-off ones (manager). */
  @Get('rooms')
  async rooms(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const all = q.active === 'all' && ctx.role === 'manager';
    return { data: await this.db.rows(`SELECT r.id, r.name, r.purpose, r.branch_id, r.active, b.name AS branch_name FROM rooms r JOIN branches b ON b.id = r.branch_id
      WHERE r.tenant_id = $1 ${all ? '' : 'AND r.active AND b.active'} ORDER BY r.active DESC, r.name LIMIT 500`, [ctx.tenantId]) };
  }

  @Roles('manager') @Post('rooms')
  async createRoom(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(roomCreateSchema, body);
    return this.db.tx(async (c) => {
      const branch = await this.activeBranch(c, ctx, input.branch_id);
      if ((await c.query(`SELECT 1 FROM rooms WHERE tenant_id = $1 AND branch_id = $2 AND lower(name) = lower($3)`, [ctx.tenantId, input.branch_id, input.name])).rowCount)
        throw conflict('DUPLICATE', 'Bu filialda shu nomli xona allaqachon bor');
      const id = (await c.query(`INSERT INTO rooms (id, tenant_id, branch_id, name, purpose, active) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`,
        [ctx.tenantId, input.branch_id, input.name, input.purpose ?? null, input.active])).rows[0].id as string;
      await audit(c, ctx, 'room.create', 'room', id, `Xona qo‘shildi: «${input.name}» (${branch.name})`, input.branch_id);
      return { data: { id } };
    });
  }

  @Roles('manager') @Patch('rooms/:id')
  async patchRoom(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(roomPatchSchema, body);
    if (!isUuid(id)) throw notFound('Xona');
    return this.db.tx(async (c) => {
      const r = (await c.query(`SELECT * FROM rooms WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!r) throw notFound('Xona');
      const changes: string[] = [];
      const branchId = input.branch_id ?? r.branch_id;
      const name = input.name ?? r.name;
      if (input.branch_id !== undefined && input.branch_id !== r.branch_id) {
        const b = await this.activeBranch(c, ctx, input.branch_id);
        changes.push(`filial: ${b.name}`);
      }
      if (input.name !== undefined && input.name !== r.name) changes.push(`nomi: «${input.name}»`);
      if ((input.name !== undefined || input.branch_id !== undefined) &&
          (await c.query(`SELECT 1 FROM rooms WHERE tenant_id = $1 AND branch_id = $2 AND lower(name) = lower($3) AND id <> $4`, [ctx.tenantId, branchId, name, id])).rowCount)
        throw conflict('DUPLICATE', 'Bu filialda shu nomli xona allaqachon bor');
      if (input.purpose !== undefined && input.purpose !== r.purpose) changes.push('yo‘nalish');
      if (input.active !== undefined && input.active !== r.active) changes.push(input.active ? 'faol qilindi' : 'nofaol qilindi');
      await c.query(`UPDATE rooms SET name = $2, branch_id = $3, purpose = CASE WHEN $4::boolean THEN $5 ELSE purpose END, active = COALESCE($6, active) WHERE id = $1`,
        [id, name, branchId, input.purpose !== undefined, input.purpose ?? null, input.active ?? null]);
      if (changes.length) await audit(c, ctx, 'room.update', 'room', id, `${r.name}: ${changes.join(', ')}`, branchId);
      return { data: { ok: true, changes } };
    });
  }

  /** A branch of this clinic that is switched on, or a field error pointing at `branch_id`. */
  private async activeBranch(c: PoolClient, ctx: Ctx, branchId: string) {
    const b = (await c.query(`SELECT id, name, active FROM branches WHERE id = $1 AND tenant_id = $2`, [branchId, ctx.tenantId])).rows[0];
    if (!b) throw invalid({ branch_id: 'Filial topilmadi' });
    if (!b.active) throw invalid({ branch_id: 'Filial nofaol — avval uni faollashtiring' });
    return b as { id: string; name: string };
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

  /** Catalogue; `price` is the general price, or the branch's own price when `?branch_id=` names one of the person's branches. */
  @Get('services')
  async services(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const branch = isUuid(q.branch_id) && ctx.branchIds.includes(q.branch_id) ? q.branch_id : null;
    const params: unknown[] = [ctx.tenantId, branch];
    let where = 's.tenant_id = $1';
    if (q.category) { params.push(String(q.category)); where += ` AND s.category = $${params.length}`; }
    if (q.active !== 'all') where += ' AND s.active';
    const rows = await this.db.rows(
      `SELECT s.id, s.code, s.name, s.category, s.duration_min, ${ctx.role === 'manager' ? 's.share_percent' : 'NULL::numeric AS share_percent'}, s.active, s.lab_template,
              ${PRICE_SQL.replace('$BRANCH', '$2::uuid')} AS price,
              ${PRICE_SQL.replace('$BRANCH', 'NULL')} AS general_price,
              EXISTS (SELECT 1 FROM service_orders o WHERE o.service_id = s.id) AS used
         FROM services s WHERE ${where} ORDER BY s.code LIMIT 1000`, params);
    return { data: rows };
  }

  @Roles('manager') @Post('services')
  async createService(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(serviceCreateSchema, body);
    if (input.category !== 'lab' && input.lab_template?.length) throw invalid({ lab_template: 'Natija shakli faqat laboratoriya xizmati uchun' });
    return this.db.tx(async (c) => {
      await c.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [ctx.tenantId]); // one code generator per clinic at a time
      if ((await c.query(`SELECT 1 FROM services WHERE tenant_id = $1 AND lower(name) = lower($2)`, [ctx.tenantId, input.name])).rowCount)
        throw conflict('DUPLICATE', 'Bu nomdagi xizmat allaqachon bor');
      const prefix = CODE_PREFIX[input.category];
      const taken = new Set((await c.query(`SELECT code FROM services WHERE tenant_id = $1`, [ctx.tenantId])).rows.map((r) => r.code as string));
      let n = 1; while (taken.has(`${prefix}${String(n).padStart(2, '0')}`)) n++;
      const code = `${prefix}${String(n).padStart(2, '0')}`;
      const id = (await c.query(
        `INSERT INTO services (id, tenant_id, code, name, category, duration_min, share_percent, lab_template, active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8, demo_now(), demo_now()) RETURNING id`,
        [ctx.tenantId, code, input.name, input.category, input.duration_min, input.share_percent, input.lab_template?.length ? JSON.stringify(input.lab_template) : null, input.active])).rows[0].id as string;
      await c.query(`INSERT INTO service_prices (tenant_id, service_id, branch_id, amount, valid_from) VALUES ($1,$2,NULL,$3, demo_now())`, [ctx.tenantId, id, input.price]);
      await audit(c, ctx, 'service.create', 'service', id, `Xizmat qo‘shildi: ${code} «${input.name}», ${som(input.price)} so‘m`);
      return { data: { id, code } };
    });
  }

  @Roles('manager') @Patch('services/:id')
  async patchService(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(servicePatchSchema, body);
    if (!isUuid(id)) throw notFound('Xizmat');
    if (input.branch_id && input.price === undefined) throw invalid({ price: 'Filial narxini kiriting' });
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT * FROM services WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!s) throw notFound('Xizmat');
      const category = input.category ?? s.category;
      const template = input.lab_template === undefined ? s.lab_template : input.lab_template?.length ? input.lab_template : null;
      if (category !== 'lab' && template?.length) throw invalid({ lab_template: 'Natija shakli faqat laboratoriya xizmati uchun' });
      const changes: string[] = [];
      if (input.name !== undefined && input.name !== s.name) {
        if ((await c.query(`SELECT 1 FROM services WHERE tenant_id = $1 AND lower(name) = lower($2) AND id <> $3`, [ctx.tenantId, input.name, id])).rowCount)
          throw conflict('DUPLICATE', 'Bu nomdagi xizmat allaqachon bor');
        changes.push(`nomi: «${input.name}»`);
      }
      if (input.category !== undefined && input.category !== s.category) changes.push(`turi: ${input.category}`);
      if (input.duration_min !== undefined && input.duration_min !== s.duration_min) changes.push(`davomiylik: ${input.duration_min} daq.`);
      if (input.share_percent !== undefined && input.share_percent !== Number(s.share_percent)) changes.push(`ulush: ${Number(s.share_percent)}% → ${input.share_percent}%`);
      if (input.lab_template !== undefined && JSON.stringify(template) !== JSON.stringify(s.lab_template)) changes.push('natija shakli');
      if (input.active !== undefined && input.active !== s.active) changes.push(input.active ? 'faol qilindi' : 'nofaol qilindi');
      await c.query(`UPDATE services SET name = COALESCE($2, name), category = $3, duration_min = COALESCE($4, duration_min), share_percent = COALESCE($5, share_percent),
                       lab_template = $6, active = COALESCE($7, active), updated_at = demo_now() WHERE id = $1`,
        [id, input.name ?? null, category, input.duration_min ?? null, input.share_percent ?? null, template ? JSON.stringify(template) : null, input.active ?? null]);
      if (input.price !== undefined) {
        let branchName: string | null = null;
        if (input.branch_id) branchName = (await this.activeBranch(c, ctx, input.branch_id)).name;
        const cur = (await c.query(`SELECT ${PRICE_SQL.replace('$BRANCH', '$2::uuid')} AS price FROM services s WHERE s.id = $1`, [id, input.branch_id ?? null])).rows[0].price;
        if (Number(cur) !== input.price) {
          // new price applies to future orders; existing orders keep their price snapshot
          await c.query(`INSERT INTO service_prices (tenant_id, service_id, branch_id, amount, valid_from) VALUES ($1,$2,$3,$4, demo_now())`, [ctx.tenantId, id, input.branch_id ?? null, input.price]);
          changes.push(`narx${branchName ? ` (${branchName})` : ''}: ${som(Number(cur))} → ${som(input.price)} so‘m`);
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

export const REQUIRED_FOR_SIGN = ['complaints', 'examination', 'diagnosis', 'recommendations'] as const;
