import { Controller, Get, Query } from '@nestjs/common';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { isDate, isUuid } from '../core/validate';
import { branchScope } from '../core/scope';
import { addDays, dayStart, now, today } from '../core/clock';

@Controller('queue')
export class QueueController {
  constructor(private db: Db) {}

  /** Live queue for a local day: tickets (arrived/in progress/done) plus today's not-yet-arrived bookings. */
  @Roles('manager', 'registrar', 'doctor', 'cashier') @Get()
  async queue(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const day = isDate(q.date) ? q.date : today();
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), day];
    let doctorFilter = '';
    if (ctx.role === 'doctor') { params.push(ctx.doctorId); doctorFilter = `AND a.doctor_id = $${params.length}`; }
    else if (isUuid(q.doctor_id)) { params.push(q.doctor_id); doctorFilter = `AND a.doctor_id = $${params.length}`; }
    const tickets = await this.db.rows(
      `SELECT qt.id, qt.number, qt.arrived_at, qt.started_at, qt.finished_at, qt.wait_seconds, a.id AS appointment_id, a.status, a.version, a.starts_at,
              a.branch_id, b.name AS branch_name, a.doctor_id, d.display_name AS doctor_name, d.specialty, s.name AS service_name, r.name AS room_name,
              p.id AS patient_id, p.patient_number, p.last_name, p.first_name, e.id AS encounter_id
         FROM queue_tickets qt JOIN appointments a ON a.id = qt.appointment_id JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id
         JOIN services s ON s.id = a.service_id JOIN branches b ON b.id = a.branch_id LEFT JOIN rooms r ON r.id = a.room_id LEFT JOIN encounters e ON e.appointment_id = a.id
        WHERE qt.tenant_id = $1 AND qt.branch_id = ANY($2) AND qt.local_date = $3 ${doctorFilter}
        ORDER BY CASE a.status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 ELSE 2 END, qt.number`, params);
    params.push(dayStart(day), dayStart(addDays(day, 1)));
    const expected = await this.db.rows(
      `SELECT a.id AS appointment_id, a.status, a.version, a.starts_at, a.branch_id, b.name AS branch_name, d.display_name AS doctor_name, s.name AS service_name,
              p.id AS patient_id, p.patient_number, p.last_name, p.first_name
         FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id JOIN services s ON s.id = a.service_id JOIN branches b ON b.id = a.branch_id
        WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND $3::date IS NOT NULL AND a.status = 'scheduled' AND a.starts_at >= $${params.length - 1} AND a.starts_at < $${params.length} ${doctorFilter}
        ORDER BY a.starts_at`, params);
    return { data: { date: day, now: now().toISOString(), tickets, expected } };
  }
}
