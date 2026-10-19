import { Body, Controller, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { schedulePutSchema, staffCreateSchema, staffUpdateSchema } from '@meduza/contracts';
import { generateTempPassword, hashPassword, SEED_IDS } from '@meduza/db';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, forbidden, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { localDate, localTime, now, toMinutes, weekday } from '../core/clock';

const WEEKDAY = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
const ROLE_LABEL: Record<string, string> = { manager: 'Rahbar', registrar: 'Registrator', doctor: 'Shifokor', cashier: 'Kassir', lab: 'Laborant' };
const LOGIN_TAKEN = () => new AppError(409, 'LOGIN_TAKEN', 'Bu login band. Boshqa telefon yoki login kiriting.', { login: 'Bu login band' });

/** Clinic manager creates and maintains staff accounts. Every query is scoped to the manager's tenant. */
@Roles('manager')
@Controller('staff')
export class StaffController {
  constructor(private db: Db) {}

  /** Branches must belong to the tenant and to the manager's own branch scope. */
  private checkBranches(ctx: Ctx, ids: string[]) {
    const uniq = [...new Set(ids)];
    if (uniq.some((b) => !ctx.branchIds.includes(b))) throw invalid({ branch_ids: 'Filial topilmadi yoki sizga biriktirilmagan' });
    return uniq;
  }

  private async checkServices(q: Q, ctx: Ctx, ids: string[]) {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return uniq;
    const n = (await q.query(`SELECT count(*)::int AS n FROM services WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [ctx.tenantId, uniq])).rows[0].n;
    if (n !== uniq.length) throw invalid({ 'doctor.service_ids': 'Xizmat topilmadi' });
    return uniq;
  }

  private async loginFree(q: Q, login: string, exceptUser?: string) {
    const r = await q.query(`SELECT 1 FROM users WHERE login = $1 AND id IS DISTINCT FROM $2`, [login, exceptUser ?? null]);
    if (r.rowCount) throw LOGIN_TAKEN();
  }

  @Post() @HttpCode(201)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(staffCreateSchema, body);
    const branchIds = this.checkBranches(ctx, input.branch_ids);
    const temp = generateTempPassword();
    const hash = await hashPassword(temp);
    try {
      const membershipId = await this.db.tx(async (c) => {
        await this.loginFree(c, input.login);
        const serviceIds = input.doctor ? await this.checkServices(c, ctx, input.doctor.service_ids ?? []) : [];
        const userId = randomUUID(), mId = randomUUID();
        await c.query(`INSERT INTO users (id, email, full_name, login, password_hash, must_change_password) VALUES ($1, NULL, $2, $3, $4, true)`,
          [userId, input.full_name, input.login, hash]);
        await c.query(`INSERT INTO memberships (id, tenant_id, user_id, role, branch_ids, title, status, demo_card) VALUES ($1,$2,$3,$4,$5,$6,'active',false)`,
          [mId, ctx.tenantId, userId, input.role, branchIds, input.title ?? null]);
        if (input.role === 'doctor' && input.doctor) {
          const docId = randomUUID();
          await c.query(`INSERT INTO doctors (id, tenant_id, membership_id, display_name, specialty, default_share_percent, active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
            [docId, ctx.tenantId, mId, input.full_name, input.doctor.specialty, input.doctor.share_percent ?? 0]);
          for (const s of serviceIds) await c.query(`INSERT INTO doctor_services (tenant_id, doctor_id, service_id) VALUES ($1,$2,$3)`, [ctx.tenantId, docId, s]);
        }
        await audit(c, ctx, 'staff.create', 'membership', mId, `Yangi xodim: ${input.full_name} (${ROLE_LABEL[input.role]}), login ${input.login}`);
        return mId;
      });
      // The temporary password is returned exactly once and is never stored in clear text.
      return { data: { membership_id: membershipId, login: input.login, temp_password: temp } };
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint).includes('login')) throw LOGIN_TAKEN();
      throw e;
    }
  }

  @Patch(':id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('Xodim');
    const input = parse(staffUpdateSchema, body);
    try {
      return await this.db.tx(async (c) => {
        // Staff changes in one clinic run one at a time, so two managers can't remove each other concurrently.
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('staff:' || $1))`, [ctx.tenantId]);
        const m = (await c.query(
          `SELECT m.id, m.user_id, m.role, m.status, m.demo_card, u.full_name, u.login, d.id AS doctor_id
             FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN doctors d ON d.membership_id = m.id
            WHERE m.id = $1 AND m.tenant_id = $2 FOR UPDATE OF m`, [id, ctx.tenantId])).rows[0];
        if (!m) throw notFound('Xodim');
        const self = m.id === ctx.membershipId;
        const roleChanges = input.role !== undefined && input.role !== m.role;
        const deactivates = input.status === 'inactive' && m.status === 'active';
        if (roleChanges && m.role === 'doctor') throw invalid({ role: 'Shifokor rolini o‘zgartirib bo‘lmaydi' });
        if (self && (roleChanges || deactivates || input.branch_ids)) throw forbidden('O‘z rolingiz, holatingiz va filiallaringizni o‘zgartira olmaysiz');
        // Keep the shared demo usable: its role cards cannot be disabled or re-roled by a visitor.
        if (m.demo_card && [SEED_IDS.tenant, SEED_IDS.tenant2].includes(ctx.tenantId) && (roleChanges || deactivates))
          throw forbidden('Demo kartadagi xodimni o‘chirib yoki rolini o‘zgartirib bo‘lmaydi');
        if (m.role === 'manager' && m.status === 'active' && (roleChanges || deactivates)) {
          const others = (await c.query(`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND role = 'manager' AND status = 'active' AND id <> $2`, [ctx.tenantId, m.id])).rows[0].n;
          if (!others) throw conflict('LAST_MANAGER', 'Klinikada kamida bitta faol rahbar qolishi kerak');
        }
        if (input.doctor && !m.doctor_id) throw invalid({ 'doctor.specialty': 'Bu xodim shifokor emas' });

        const changed: string[] = [];
        if (input.full_name !== undefined && input.full_name !== m.full_name) {
          await c.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [m.user_id, input.full_name]);
          if (m.doctor_id) await c.query(`UPDATE doctors SET display_name = $2 WHERE id = $1`, [m.doctor_id, input.full_name]);
          changed.push('F.I.Sh.');
        }
        if (input.login !== undefined && input.login !== m.login) {
          await this.loginFree(c, input.login, m.user_id);
          await c.query(`UPDATE users SET login = $2 WHERE id = $1`, [m.user_id, input.login]);
          changed.push(`login → ${input.login}`);
        }
        const sets: string[] = [], vals: unknown[] = [m.id];
        if (roleChanges) { vals.push(input.role); sets.push(`role = $${vals.length}`); changed.push(`rol → ${ROLE_LABEL[input.role!]}`); }
        if (input.title !== undefined) { vals.push(input.title ?? null); sets.push(`title = $${vals.length}`); changed.push('lavozim'); }
        if (input.branch_ids && m.doctor_id) {
          const used = (await c.query(`SELECT DISTINCT b.name FROM schedules s JOIN branches b ON b.id = s.branch_id WHERE s.doctor_id = $1 AND NOT (s.branch_id = ANY($2::uuid[]))`,
            [m.doctor_id, input.branch_ids])).rows.map((r) => r.name);
          if (used.length) throw invalid({ branch_ids: `Ish jadvalida ${used.join(', ')} bor — avval jadvalni o‘zgartiring` });
        }
        if (input.branch_ids) { vals.push(this.checkBranches(ctx, input.branch_ids)); sets.push(`branch_ids = $${vals.length}`); changed.push('filiallar'); }
        if (input.status !== undefined && input.status !== m.status) { vals.push(input.status); sets.push(`status = $${vals.length}`); changed.push(input.status === 'active' ? 'faollashtirildi' : 'faolsizlantirildi'); }
        if (sets.length) await c.query(`UPDATE memberships SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
        if (input.status !== undefined && m.doctor_id) await c.query(`UPDATE doctors SET active = $2 WHERE id = $1`, [m.doctor_id, input.status === 'active']);
        // Role or access removed: open sessions end immediately.
        if (deactivates || roleChanges) await c.query(`DELETE FROM sessions WHERE membership_id = $1`, [m.id]);

        if (input.doctor && m.doctor_id) {
          if (input.doctor.specialty !== undefined) { await c.query(`UPDATE doctors SET specialty = $2 WHERE id = $1`, [m.doctor_id, input.doctor.specialty]); changed.push('mutaxassislik'); }
          if (input.doctor.share_percent !== undefined) { await c.query(`UPDATE doctors SET default_share_percent = $2 WHERE id = $1`, [m.doctor_id, input.doctor.share_percent]); changed.push(`ulush ${input.doctor.share_percent}%`); }
          if (input.doctor.service_ids !== undefined) {
            const ids = await this.checkServices(c, ctx, input.doctor.service_ids);
            await c.query(`DELETE FROM doctor_services WHERE doctor_id = $1 AND NOT (service_id = ANY($2::uuid[]))`, [m.doctor_id, ids]);
            for (const s of ids) await c.query(`INSERT INTO doctor_services (tenant_id, doctor_id, service_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ctx.tenantId, m.doctor_id, s]);
            changed.push('xizmatlar');
          }
        }
        if (changed.length) await audit(c, ctx, 'staff.update', 'membership', m.id, `${input.full_name ?? m.full_name}: ${changed.join(', ')}`);
        return { data: { ok: true, changed } };
      });
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint).includes('login')) throw LOGIN_TAKEN();
      throw e;
    }
  }

  /** Issues a new temporary password (shown once), unlocks the account and closes its sessions. */
  @Post(':id/reset-password') @HttpCode(200)
  async resetPassword(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Xodim');
    if (id === ctx.membershipId) throw forbidden('O‘z parolingizni «Parolni o‘zgartirish» orqali almashtiring');
    const temp = generateTempPassword();
    const hash = await hashPassword(temp);
    return this.db.tx(async (c) => {
      const m = (await c.query(
        `SELECT m.id, m.user_id, u.full_name, u.login, m.status,
                EXISTS (SELECT 1 FROM memberships o WHERE o.user_id = m.user_id AND o.tenant_id <> m.tenant_id) AS shared
           FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = $1 AND m.tenant_id = $2 FOR UPDATE OF u`, [id, ctx.tenantId])).rows[0];
      if (!m) throw notFound('Xodim');
      // A person who also works in another clinic manages their own password.
      if (m.shared) throw forbidden('Bu xodim boshqa klinikada ham ishlaydi — parolni faqat o‘zi o‘zgartiradi');
      if (!m.login) throw invalid({ login: 'Avval xodimga login bering' });
      await c.query(`UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1`, [m.user_id, hash]);
      await c.query(`DELETE FROM sessions WHERE membership_id IN (SELECT id FROM memberships WHERE user_id = $1) AND token_hash <> $2`, [m.user_id, ctx.sessionHash]);
      await audit(c, ctx, 'staff.password_reset', 'membership', m.id, `${m.full_name}: vaqtinchalik parol berildi`);
      return { data: { membership_id: m.id, login: m.login, temp_password: temp } };
    });
  }

  /**
   * Replaces a doctor's weekly schedule. Future bookings that no longer fit are never touched: the first call
   * returns 409 SCHEDULE_CONFLICTS with the list, and saving anyway needs confirm_conflicts (registrar reschedules them).
   */
  @Put('doctors/:id/schedule')
  async putSchedule(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('Shifokor');
    const input = parse(schedulePutSchema, body);
    return this.db.tx(async (c) => {
      const d = (await c.query(
        `SELECT d.id, d.display_name, m.branch_ids FROM doctors d LEFT JOIN memberships m ON m.id = d.membership_id
          WHERE d.id = $1 AND d.tenant_id = $2 FOR UPDATE OF d`, [id, ctx.tenantId])).rows[0];
      if (!d) throw notFound('Shifokor');
      const allowed: string[] = d.branch_ids ?? ctx.branchIds;
      const fields: Record<string, string> = {};
      const rooms = (await c.query(`SELECT id, branch_id FROM rooms WHERE tenant_id = $1`, [ctx.tenantId])).rows;
      input.days.forEach((day, i) => {
        if (!ctx.branchIds.includes(day.branch_id)) fields[`days.${i}.branch_id`] = 'Filial topilmadi yoki sizga biriktirilmagan';
        else if (!allowed.includes(day.branch_id)) fields[`days.${i}.branch_id`] = 'Shifokor bu filialga biriktirilmagan — avval xodim kartasida filialni qo‘shing';
        if (day.room_id && !rooms.some((r) => r.id === day.room_id && r.branch_id === day.branch_id)) fields[`days.${i}.room_id`] = 'Xona shu filialda emas';
      });
      if (Object.keys(fields).length) throw invalid(fields);

      // Future active bookings that would fall outside the new schedule.
      const byDay = new Map(input.days.map((x) => [x.weekday, x]));
      const future = (await c.query(
        `SELECT a.id, a.starts_at, a.ends_at, a.branch_id, p.patient_number, p.last_name, p.first_name, s.name AS service_name
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN services s ON s.id = a.service_id
          WHERE a.doctor_id = $1 AND a.tenant_id = $2 AND a.status IN ('scheduled','arrived') AND a.starts_at >= $3 ORDER BY a.starts_at`,
        [id, ctx.tenantId, now()])).rows;
      const conflicts = future.flatMap((a) => {
        const date = localDate(a.starts_at), st = toMinutes(localTime(a.starts_at)), en = toMinutes(localTime(a.ends_at));
        const day = byDay.get(weekday(date));
        let reason: string | null = null;
        if (!day) reason = 'Bu kuni ishlamaydi';
        else if (day.branch_id !== a.branch_id) reason = 'Boshqa filialda';
        else if (st < toMinutes(day.start) || en > toMinutes(day.end)) reason = `Ish vaqtidan tashqarida (${day.start}–${day.end})`;
        else if (day.break_start && day.break_end && st < toMinutes(day.break_end) && toMinutes(day.break_start) < en) reason = `Tanaffusga to‘g‘ri keladi (${day.break_start}–${day.break_end})`;
        return reason ? [{ appointment_id: a.id, date, time: localTime(a.starts_at), patient_number: a.patient_number, patient: `${a.last_name} ${a.first_name}`, service_name: a.service_name, reason }] : [];
      });
      if (conflicts.length && !input.confirm_conflicts)
        throw conflict('SCHEDULE_CONFLICTS', `${conflicts.length} ta kelgusi qabul yangi jadvalga sig‘maydi`, { conflicts });

      await c.query(`DELETE FROM schedules WHERE doctor_id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
      for (const day of input.days)
        await c.query(`INSERT INTO schedules (id, tenant_id, doctor_id, branch_id, room_id, weekday, start_time, end_time, break_start, break_end)
                       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ctx.tenantId, id, day.branch_id, day.room_id ?? null, day.weekday, day.start, day.end, day.break_start ?? null, day.break_end ?? null]);
      const daysText = input.days.length ? [...input.days].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7)).map((x) => WEEKDAY[x.weekday].slice(0, 2)).join(', ') : 'ish kuni yo‘q';
      await audit(c, ctx, 'doctor.schedule', 'doctor', id,
        `${d.display_name}: ish jadvali yangilandi (${daysText})${conflicts.length ? `; jadvalga sig‘magan ${conflicts.length} ta qabul qoldi` : ''}`);
      return { data: { ok: true, conflicts } };
    });
  }
}
