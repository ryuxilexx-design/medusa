export { formatSom, formatPhone, parseSomToTiyin } from '@meduza/contracts';

const TZ = 'Asia/Tashkent';
const dtf = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, ...o });
const fTime = dtf({ hour: '2-digit', minute: '2-digit', hour12: false });
const fDate = dtf({ day: '2-digit', month: '2-digit', year: 'numeric' });

export const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
export const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
export const WEEKDAYS_SHORT = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

export function fmtTime(d: string | Date | null | undefined) { return d ? fTime.format(new Date(d)) : '—'; }
export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; }
  return fDate.format(new Date(d));
}
export function fmtDateTime(d: string | Date | null | undefined) { return d ? `${fmtDate(d)} ${fmtTime(d)}` : '—'; }
/** Local (Tashkent) calendar date of an instant, YYYY-MM-DD */
export function localDate(d: string | Date) { return new Date(new Date(d).getTime() + 5 * 3600_000).toISOString().slice(0, 10); }
export function longDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${d}-${MONTHS[m - 1]} ${y}, ${WEEKDAYS[wd].toLowerCase()}`;
}
export function addDays(date: string, n: number) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function ageFrom(birth: string, today: string) {
  const [y, m, d] = birth.split('-').map(Number); const [cy, cm, cd] = today.split('-').map(Number);
  const age = cy - y - (cm < m || (cm === m && cd < d) ? 1 : 0);
  if (age > 0) return `${age} yosh`;
  const months = (cy - y) * 12 + (cm - m) - (cd < d ? 1 : 0);
  return `${Math.max(0, months)} oy`;
}
export function fullName(p: { last_name?: string; first_name?: string; middle_name?: string | null } | null | undefined, withMiddle = false) {
  if (!p) return '—';
  return [p.last_name, p.first_name, withMiddle ? p.middle_name : null].filter(Boolean).join(' ');
}
export const pid = (n: number | string | null | undefined) => (n == null ? '—' : `#${n}`);
export function duration(sec: number | null | undefined) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} daq.`;
  return `${Math.floor(m / 60)} soat ${m % 60} daq.`;
}
