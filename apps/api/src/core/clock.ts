
export const TZ_OFFSET_MS = 5 * 3600_000; // Asia/Tashkent (UTC+5, no DST)
/**
 * Demo clock. The single source of truth is the `demo_clock` row in PostgreSQL (`demo_now()`):
 * DEMO_DATE + DEMO_TIME at the last explicit demo reset, advancing in real time. An API restart
 * never rewinds it. The guard refreshes the offset from the database on every request, so a reset
 * done from the CLI is picked up immediately and JS timestamps match DB defaults.
 */
let offsetMs = 0;
export function syncClock(dbDemoNow: Date) { offsetMs = new Date(dbDemoNow).getTime() - Date.now(); }
export function now(): Date { return new Date(Date.now() + offsetMs); }

export function localDate(d: Date = now()): string {
  return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
export function localTime(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(11, 16);
}
export function today(): string { return localDate(now()); }

/** Local date + HH:MM -> UTC instant */
export function localToUtc(date: string, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi) - TZ_OFFSET_MS);
}
/** Start of a local day as UTC instant; filters use [start(from), start(to + 1)). */
export function dayStart(date: string): Date { return localToUtc(date, '00:00'); }
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function weekday(date: string): number { return new Date(date + 'T00:00:00Z').getUTCDay(); }
export function toMinutes(hhmm: string): number { const [h, m] = hhmm.slice(0, 5).split(':').map(Number); return h * 60 + m; }
export function fromMinutes(min: number): string { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
