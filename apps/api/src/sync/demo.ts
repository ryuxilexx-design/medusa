// The demo clinic's MedPlus connection: a source without a bridge key (the manager presses «Yangi kalit» to try the
// bridge) and a few mirrored records applied through the real upsert path. Static records, outside the seed PRNG,
// dated a few days before the demo day — today's KPIs (visits, revenue, payments, debt) do not change.
import { SEED_IDS } from '@meduza/db';
import { Db } from '../core/db';
import { addDays } from '../core/clock';
import { runBatch, systemCtx, Source } from './ingest';

export const DEMO_SOURCE_NAME = 'MedPlus (demo)';

export function demoMirrorRecords(demoDate: string, doctorName: string) {
  const d4 = addDays(demoDate, -4), d3 = addDays(demoDate, -3);
  return [
    { kind: 'branch', external_id: '1', data: { name: 'Markaziy filial' } },
    { kind: 'branch', external_id: '2', data: { name: 'Yunusobod filiali' } },
    { kind: 'patient', external_id: '27101', data: { full_name: 'Abdullayeva Malika Rustamovna', birth_date: '12.03.1988', sex: 'Ж', phone: '+998 97 300 11 01', address: 'Toshkent, Chilonzor' } },
    { kind: 'patient', external_id: '27102', data: { full_name: 'Rashidov Bekzod Anvarovich', birth_date: '01.07.1979', sex: 'М', phone: '+998 97 300 11 02' } },
    { kind: 'patient', external_id: '27103', data: { full_name: 'Yo‘ldosheva Sevara', birth_date: '20.02.2015', sex: 'Ж', phone: '+998 97 300 11 03' } },
    { kind: 'visit', external_id: '81001', data: { patient_id: '27101', branch_id: '1', doctor_name: doctorName, service_name: 'Консультация терапевта', starts_at: `${d4} 10:00:00`, duration_min: 20 } },
    { kind: 'order', external_id: '91001', data: { patient_id: '27101', visit_id: '81001', service_name: 'Консультация терапевта', doctor_name: doctorName, price: 150_000_00, discount: 10_000_00, doctor_percent: 30, ordered_at: `${d4} 10:00:00` } },
    { kind: 'order', external_id: '91002', data: { patient_id: '27101', visit_id: '81001', service_name: 'Общий анализ крови', price: 60_000_00, ordered_at: `${d4} 10:15:00` } },
    { kind: 'payment', external_id: '61001', data: { patient_id: '27101', branch_id: '1', amount: 200_000_00, method: 'Наличными', paid_at: `${d4} 10:40:00`, cashier: 'MedPlus kassa' } },
    { kind: 'visit', external_id: '81002', data: { patient_id: '27102', branch_id: '2', service_name: 'УЗИ брюшной полости', starts_at: `${d3} 15:00:00`, duration_min: 30 } },
    { kind: 'order', external_id: '91003', data: { patient_id: '27102', visit_id: '81002', service_name: 'УЗИ брюшной полости', price: 120_000_00, ordered_at: `${d3} 15:00:00` } },
    { kind: 'payment', external_id: '61002', data: { patient_id: '27102', branch_id: '2', amount: 120_000_00, method: 'Терминал', paid_at: `${d3} 15:35:00`, cashier: 'MedPlus kassa' } },
    { kind: 'daily_totals', external_id: `${d4}:1`, data: { date: d4, branch_id: '1', payments_sum: 200_000_00, payments_count: 1 } },
    { kind: 'daily_totals', external_id: `${d3}:2`, data: { date: d3, branch_id: '2', payments_sum: 120_000_00, payments_count: 1, patients_total: 3 } },
  ];
}

/** Creates the demo source and its records once (API start and after a demo reset). Returns the number of records applied. */
export async function ensureDemoMirror(db: Db, demoDate: string): Promise<number> {
  const tenant = SEED_IDS.tenant;
  if (!(await db.one(`SELECT 1 FROM tenants WHERE id = $1`, [tenant]))) return 0;
  if (await db.one(`SELECT 1 FROM external_sources WHERE tenant_id = $1`, [tenant])) return 0;
  const doctor = (await db.one(`SELECT display_name FROM doctors WHERE id = $1`, [SEED_IDS.doctor(1)]))?.display_name ?? 'Shifokor';
  const src = (await db.one<Source>(
    `INSERT INTO external_sources (tenant_id, kind, name, created_by_name) VALUES ($1, 'medplus', $2, 'Demo') ON CONFLICT (tenant_id, kind) DO NOTHING RETURNING id, tenant_id, kind, name, settings`,
    [tenant, DEMO_SOURCE_NAME]));
  if (!src) return 0;
  const r = await runBatch(db, src, demoMirrorRecords(demoDate, doctor), { channel: 'bridge', actor: DEMO_SOURCE_NAME, ctx: systemCtx(src) });
  return r.created + r.updated;
}
