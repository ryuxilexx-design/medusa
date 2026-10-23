// Booking rules shared by the staff UI and the Telegram bot: one implementation of slot validation,
// availability, create, reschedule and cancel. Overlaps are still enforced by the DB exclusion constraints.
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { conflict, forbidden, invalid, notFound, staleState } from '../core/errors';
import { audit } from '../core/audit';
import { addDays, fromMinutes, localDate, localTime, localToUtc, now, toMinutes, weekday } from '../core/clock';
import { assertBranch } from '../core/scope';
import { enqueueNotice } from '../telegram/outbox';
import { isUuid } from '../core/validate';

export async function lockAppointment(c: Q, ctx: Ctx, id: string) {
  if (!isUuid(id)) throw notFound('Qabul');
  const a = (await c.query(`SELECT * FROM appointments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
  if (!a) throw notFound('Qabul');
  if (!ctx.branchIds.includes(a.branch_id)) throw notFound('Qabul');
  if (ctx.role === 'doctor' && a.doctor_id !== ctx.doctorId) throw forbidden('Bu qabul sizga tegishli emas');
  return a;
}

export type DayException = { id: string; kind: 'day_off' | 'vacation' | 'holiday' | 'custom_hours'; start: string | null; end: string | null; note: string | null };
export const EXCEPTION_REASON: Record<string, string> = { day_off: 'dam olish kuni', vacation: 'ta’til', holiday: 'bayram kuni' };
export const BLOCKING_KINDS = ['day_off', 'vacation', 'holiday'];

/**
 * The exception that applies to a doctor on a date: the doctor's own row wins over a clinic-wide one; a clinic-wide
 * row with a branch applies only to doctors working in that branch that day. Shared by the staff API and the
 * Telegram bot — the only place that reads schedule_exceptions for booking.
 */
export async function dayException(q: Q, tenantId: string, doctorId: string, date: string, branchId: string | null): Promise<DayException | null> {
  const rows = (await q.query(
    `SELECT id, kind, to_char(start_time,'HH24:MI') AS start, to_char(end_time,'HH24:MI') AS "end", note
       FROM schedule_exceptions WHERE tenant_id = $1 AND date = $2 AND (doctor_id = $3 OR (doctor_id IS NULL AND (branch_id IS NULL OR branch_id = $4)))
      ORDER BY (doctor_id IS NULL), (branch_id IS NULL)`, [tenantId, date, doctorId, branchId])).rows;
  return rows[0] ?? null;
}
export const unavailable = (exc: DayException) => conflict('DOCTOR_UNAVAILABLE', `Shifokor bu kuni qabul qilmaydi: ${EXCEPTION_REASON[exc.kind]}`, { kind: exc.kind, note: exc.note });

export type SlotInput = { branch_id: string; doctor_id: string; service_id: string; date: string; start_time: string; duration_min?: number };
/** How far in the past a start may lie: a normal booking tolerates clock skew, a walk-in starts on the grid slot that already began. */
const PAST_GRACE_MIN = 5;
export const WALK_IN_GRACE_MIN = 15, WALK_IN_WINDOW_MIN = 60, SLOT_GRID_MIN = 15;

/** Validates doctor/service/branch/schedule and returns the time window + room. */
export async function validateSlot(c: Q, ctx: Ctx, input: SlotInput, pastGraceMin = PAST_GRACE_MIN) {
  assertBranch(ctx, input.branch_id);
  const doctor = (await c.query(`SELECT id, display_name FROM doctors WHERE id = $1 AND tenant_id = $2 AND active`, [input.doctor_id, ctx.tenantId])).rows[0];
  if (!doctor) throw invalid({ doctor_id: 'Shifokor topilmadi yoki faol emas' });
  const service = (await c.query(`SELECT id, name, duration_min, active FROM services WHERE id = $1 AND tenant_id = $2`, [input.service_id, ctx.tenantId])).rows[0];
  if (!service || !service.active) throw invalid({ service_id: 'Xizmat topilmadi yoki nofaol' });
  const link = (await c.query(`SELECT 1 FROM doctor_services WHERE doctor_id = $1 AND service_id = $2`, [doctor.id, service.id])).rows[0];
  if (!link) throw invalid({ service_id: 'Bu shifokor tanlangan xizmatni ko‘rsatmaydi' });
  const sch = (await c.query(
    `SELECT s.*, b.name AS branch_name FROM schedules s JOIN branches b ON b.id = s.branch_id WHERE s.doctor_id = $1 AND s.weekday = $2`, [doctor.id, weekday(input.date)])).rows[0];
  // a day off / vacation / holiday blocks the day even when the weekly row exists; custom hours replace the row's hours
  const exc = await dayException(c, ctx.tenantId, doctor.id, input.date, sch?.branch_id ?? input.branch_id);
  if (exc && BLOCKING_KINDS.includes(exc.kind)) throw unavailable(exc);
  if (!sch) throw invalid({ date: 'Shifokor bu kuni ishlamaydi' });
  if (sch.branch_id !== input.branch_id) throw invalid({ branch_id: `Shifokor bu kuni ${sch.branch_name}da qabul qiladi` });
  const duration = input.duration_min ?? service.duration_min;
  const start = toMinutes(input.start_time), end = start + duration;
  const custom = exc?.kind === 'custom_hours';
  const workStart: string = custom ? exc!.start! : sch.start_time, workEnd: string = custom ? exc!.end! : sch.end_time;
  if (start < toMinutes(workStart) || end > toMinutes(workEnd)) throw invalid({ start_time: `Ish vaqti: ${workStart.slice(0, 5)}–${workEnd.slice(0, 5)}` });
  if (!custom && sch.break_start && start < toMinutes(sch.break_end) && toMinutes(sch.break_start) < end) throw invalid({ start_time: `Tanaffus vaqti: ${sch.break_start.slice(0, 5)}–${sch.break_end.slice(0, 5)}` });
  const startsAt = localToUtc(input.date, input.start_time);
  if (startsAt.getTime() < now().getTime() - pastGraceMin * 60_000) throw invalid({ start_time: 'O‘tgan vaqtga yozib bo‘lmaydi' });
  return { startsAt, endsAt: new Date(startsAt.getTime() + duration * 60_000), roomId: sch.room_id as string | null, service, doctor };
}

/** Free start times for a doctor on a local date, respecting schedule, break and existing bookings (15-minute grid). */
export async function availability(q: Q, tenantId: string, doctorId: string, date: string, duration: number, excludeAppointmentId: string | null = null) {
  const sch = (await q.query(
    `SELECT s.branch_id, b.name AS branch_name, to_char(s.start_time,'HH24:MI') AS start, to_char(s.end_time,'HH24:MI') AS "end",
            to_char(s.break_start,'HH24:MI') AS break_start, to_char(s.break_end,'HH24:MI') AS break_end, r.name AS room_name
       FROM schedules s JOIN branches b ON b.id = s.branch_id LEFT JOIN rooms r ON r.id = s.room_id
      WHERE s.doctor_id = $1 AND s.weekday = $2 AND s.tenant_id = $3`, [doctorId, weekday(date), tenantId])).rows[0];
  const exc = await dayException(q, tenantId, doctorId, date, sch?.branch_id ?? null);
  if (exc && BLOCKING_KINDS.includes(exc.kind)) return { working: false as const, reason: exc.kind, note: exc.note, slots: [], busy: [] };
  if (!sch) return { working: false as const, slots: [], busy: [] };
  if (exc) Object.assign(sch, { start: exc.start, end: exc.end, break_start: null, break_end: null, custom_hours: true, note: exc.note }); // custom hours: the given window, no break
  const busy = (await q.query(
    `SELECT id, starts_at, ends_at FROM appointments WHERE doctor_id = $1 AND status NOT IN ('cancelled','no_show')
        AND starts_at < $3 AND ends_at > $2 AND starts_at >= $2::timestamptz - interval '1 day' AND ($4::uuid IS NULL OR id <> $4)`, // lower bound: index range, not all history
    [doctorId, localToUtc(date, '00:00'), localToUtc(addDays(date, 1), '00:00'), excludeAppointmentId])).rows;
  const busyMin = busy.map((b) => [toMinutes(localTime(b.starts_at)), toMinutes(localTime(b.ends_at))]);
  const s0 = toMinutes(sch.start), e0 = toMinutes(sch.end);
  const bs = sch.break_start ? toMinutes(sch.break_start) : -1, be = sch.break_end ? toMinutes(sch.break_end) : -1;
  const nowLocal = localDate(now()) === date ? toMinutes(localTime(now())) : localDate(now()) > date ? 24 * 60 : -1;
  const slots: { time: string; free: boolean; past: boolean }[] = [];
  for (let t = s0; t + duration <= e0; t += 15) {
    if (bs >= 0 && t < be && bs < t + duration) continue;
    const free = !busyMin.some(([a, b]) => t < b && a < t + duration);
    slots.push({ time: fromMinutes(t), free, past: t < nowLocal });
  }
  return { working: true as const, ...sch, duration_min: duration, slots, busy: busy.map((b) => ({ start: localTime(b.starts_at), end: localTime(b.ends_at) })) };
}

/**
 * Walk-in («Hozir qabul qilish»): the start time for a patient standing at the desk — the grid slot «now» falls in
 * (already begun, within WALK_IN_GRACE_MIN) or the first free one within WALK_IN_WINDOW_MIN. The same availability
 * rules as every other booking; null when the doctor has nothing free in that window.
 */
export async function walkInSlot(q: Q, tenantId: string, doctorId: string, duration: number): Promise<{ date: string; start_time: string; branch_id: string } | null> {
  const date = localDate(now());
  const av = await availability(q, tenantId, doctorId, date, duration);
  if (!av.working) return null;
  const nowMin = toMinutes(localTime(now()));
  const from = Math.floor(nowMin / SLOT_GRID_MIN) * SLOT_GRID_MIN; // the slot that already began
  const slot = (av.slots as { time: string; free: boolean }[]).find((s) => s.free && toMinutes(s.time) >= from && toMinutes(s.time) >= nowMin - WALK_IN_GRACE_MIN && toMinutes(s.time) <= nowMin + WALK_IN_WINDOW_MIN);
  return slot ? { date, start_time: slot.time, branch_id: av.branch_id as string } : null;
}

export type CreateOptions = {
  /** staff = reception, telegram = the patient's bot, doctor = the treating doctor's follow-up from the signed note. */
  source?: 'staff' | 'telegram' | 'doctor';
  /** Walk-in: the slot that already began is allowed, and the patient at the desk gets no «you are booked» notice. */
  walkIn?: boolean;
};

/** Creates a booking. A repeated request_key returns the original appointment instead of a duplicate. */
export async function createAppointment(c: Q, ctx: Ctx, input: SlotInput & { patient_id: string; note?: string | null }, requestKey: string | null, opts: CreateOptions | 'staff' | 'telegram' = {}) {
  const { source = 'staff', walkIn = false } = typeof opts === 'string' ? { source: opts } : opts;
  if (requestKey) {
    // serialise retries of the same request, then return the original booking if it already exists
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appt:${ctx.tenantId}:${requestKey}`]);
    const prev = (await c.query(`SELECT id, patient_id, doctor_id, service_id FROM appointments WHERE tenant_id = $1 AND request_key = $2`, [ctx.tenantId, requestKey])).rows[0];
    if (prev) {
      if (prev.patient_id !== input.patient_id || prev.doctor_id !== input.doctor_id || prev.service_id !== input.service_id)
        throw conflict('IDEMPOTENCY_MISMATCH', 'Bu so‘rov kaliti boshqa qabul uchun ishlatilgan. Sahifani yangilang.');
      return { id: prev.id as string, replayed: true };
    }
  }
  const patient = (await c.query(`SELECT id, patient_number, anonymised_at FROM patients WHERE id = $1 AND tenant_id = $2`, [input.patient_id, ctx.tenantId])).rows[0];
  if (!patient) throw invalid({ patient_id: 'Bemor topilmadi' });
  // an anonymised card (ZRU-547 erasure) is closed for new visits: the person asked the clinic to stop processing their data
  if (patient.anonymised_at) throw invalid({ patient_id: 'Bemor kartasi anonimlashtirilgan' });
  const slot = await validateSlot(c, ctx, input, walkIn ? WALK_IN_GRACE_MIN : undefined);
  const row = (await c.query(
    `INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, service_id, room_id, starts_at, ends_at, status, note, created_by, created_at, updated_at, request_key, source)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,$10, demo_now(), demo_now(), $11, $12) RETURNING id`,
    [ctx.tenantId, input.branch_id, input.patient_id, input.doctor_id, input.service_id, slot.roomId, slot.startsAt, slot.endsAt, input.note ?? null,
      ctx.membershipId || null, requestKey, source])).rows[0];
  await audit(c, ctx, 'appointment.create', 'appointment', row.id,
    `#${patient.patient_number}: ${slot.service.name}, ${input.date} ${input.start_time}, ${slot.doctor.display_name}${source === 'telegram' ? ' (Telegram)' : source === 'doctor' ? ' (qayta qabul, shifokor)' : walkIn ? ' (navbatsiz)' : ''}`, input.branch_id);
  // the patient hears about a booking the clinic made for them (the bot already answered its own booking)
  if (source !== 'telegram' && !walkIn) await enqueueNotice(c, { tenantId: ctx.tenantId, kind: 'booked', patientId: input.patient_id, appointmentId: row.id, dedupeKey: `booked:${row.id}` });
  return { id: row.id as string, replayed: false };
}

/** Reschedule: updates the same row (never a duplicate). Only scheduled appointments. The patient is told unless they did it themselves. */
export async function rescheduleAppointment(c: Q, ctx: Ctx, id: string,
  input: { version: number; doctor_id?: string; service_id?: string; date?: string; start_time?: string; duration_min?: number; note?: string | null },
  byPatient = false) {
  const a = await lockAppointment(c, ctx, id);
  if (a.version !== input.version) throw staleState();
  if (a.status !== 'scheduled') throw conflict('INVALID_STATE', 'Faqat rejalashtirilgan qabulni ko‘chirish mumkin');
  const merged: SlotInput = {
    branch_id: a.branch_id, doctor_id: input.doctor_id ?? a.doctor_id, service_id: input.service_id ?? a.service_id,
    date: input.date ?? localDate(a.starts_at), start_time: input.start_time ?? localTime(a.starts_at),
    duration_min: input.duration_min ?? Math.round((a.ends_at - a.starts_at) / 60000),
  };
  // the doctor may work in another branch on the new day
  const sch = (await c.query(`SELECT branch_id FROM schedules WHERE doctor_id = $1 AND weekday = $2`, [merged.doctor_id, weekday(merged.date)])).rows[0];
  if (sch) merged.branch_id = sch.branch_id;
  if (input.service_id && !input.duration_min) delete merged.duration_min;
  const slot = await validateSlot(c, ctx, merged);
  const upd = (await c.query(
    `UPDATE appointments SET branch_id = $2, doctor_id = $3, service_id = $4, room_id = $5, starts_at = $6, ends_at = $7, note = COALESCE($8, note),
            patient_confirmed_at = NULL, version = version + 1, updated_at = demo_now() WHERE id = $1 RETURNING version`,
    [id, merged.branch_id, merged.doctor_id, merged.service_id, slot.roomId, slot.startsAt, slot.endsAt, input.note ?? null])).rows[0];
  await audit(c, ctx, 'appointment.reschedule', 'appointment', id,
    `Ko‘chirildi: ${localDate(a.starts_at)} ${localTime(a.starts_at)} → ${merged.date} ${merged.start_time}${byPatient ? ' (bemor, Telegram)' : ''}`, merged.branch_id);
  // a new time means new reminders; an old "day before" notice must not block the next one
  await c.query(`UPDATE notifications SET status = 'skipped', error = 'qabul ko‘chirildi' WHERE appointment_id = $1 AND kind IN ('reminder_day','reminder_soon') AND status = 'pending'`, [id]);
  if (!byPatient) await enqueueNotice(c, { tenantId: ctx.tenantId, kind: 'rescheduled_by_clinic', patientId: a.patient_id, appointmentId: id, dedupeKey: `rescheduled:${id}:${upd.version}` });
  return { id };
}

/** Cancels a scheduled/arrived booking. Returns whether money was already taken (needs a billing review). */
export async function cancelAppointment(c: Q, ctx: Ctx, id: string, input: { version?: number; reason?: string | null }, byPatient = false) {
  const a = await lockAppointment(c, ctx, id);
  if (input.version !== undefined && input.version !== a.version) throw staleState();
  if (!['scheduled', 'arrived'].includes(a.status)) throw conflict('INVALID_STATE', 'Bu holatdagi qabulni bekor qilib bo‘lmaydi');
  if (a.status === 'arrived' && !input.reason) throw invalid({ reason: 'Kelgan bemor qabulini bekor qilish uchun sabab kiriting' });
  await c.query(`UPDATE appointments SET status = 'cancelled', cancel_reason = $2, version = version + 1, updated_at = demo_now() WHERE id = $1`, [id, input.reason ?? null]);
  await c.query(`UPDATE service_orders SET status = 'cancelled' WHERE appointment_id = $1 AND is_primary AND status = 'ordered'`, [id]);
  await c.query(`UPDATE notifications SET status = 'skipped', error = 'qabul bekor qilindi' WHERE appointment_id = $1 AND status = 'pending' AND kind IN ('reminder_day','reminder_soon')`, [id]);
  const paid = (await c.query(`SELECT coalesce(sum(paid_amount),0)::bigint AS s FROM invoices WHERE appointment_id = $1 AND status <> 'void'`, [id])).rows[0].s;
  // nothing was paid: the visit's invoice goes with it (otherwise it would stay as debt for a visit that never happened)
  if (Number(paid) === 0) {
    const voided = (await c.query(
      `UPDATE invoices i SET status = 'void', void_reason = 'Qabul bekor qilindi', version = version + 1, updated_at = demo_now()
        WHERE i.appointment_id = $1 AND i.status <> 'void' AND i.paid_amount = 0 AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id) RETURNING i.id`, [id])).rows;
    for (const v of voided) await audit(c, ctx, 'invoice.void', 'invoice', v.id, 'Hisob bekor qilindi: qabul bekor qilindi', a.branch_id);
  }
  await audit(c, ctx, 'appointment.cancel', 'appointment', id, `Bekor qilindi${input.reason ? ': ' + input.reason : ''}`, a.branch_id);
  if (!byPatient && a.starts_at > now()) await enqueueNotice(c, { tenantId: ctx.tenantId, kind: 'cancelled_by_clinic', patientId: a.patient_id, appointmentId: id, dedupeKey: `cancelled:${id}` });
  return { id, needs_billing_review: Number(paid) > 0 };
}
