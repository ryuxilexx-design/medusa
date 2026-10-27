// Turning MedPlus values into ours: names, dates and times (Tashkent wall time unless a zone is given), sex,
// phones, PINFL, payment forms, service categories. Pure functions: unit-tested without a database.
import { createHash } from 'crypto';
import { normalizePhone } from '@meduza/contracts';
import { TZ_OFFSET_MS } from '../core/clock';

/** «Каримов Азиз Рустамович» → last, first, middle (a single word is the last name; the first name is then «—»). */
export function splitFullName(full: string): { last_name: string; first_name: string; middle_name: string | null } | null {
  const parts = full.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!parts.length) return null;
  return { last_name: parts[0], first_name: parts[1] ?? '—', middle_name: parts.length > 2 ? parts.slice(2).join(' ') : null };
}

const pad = (n: number) => String(n).padStart(2, '0');
const realDate = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * A point in time. «2026-10-17 14:05[:SS]», «17.10.2026 14:05», «2026-10-17T14:05» have no zone: they are clinic
 * (Tashkent) wall time. An ISO string with «Z» or «+05:00» keeps its zone. A bare date is 00:00 local.
 */
export function parseExtTime(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime() - TZ_OFFSET_MS); // a spreadsheet date: wall time
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  let y: number, mo: number, d: number, h = 0, mi = 0, se = 0, zone: string | undefined;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; h = +(m[4] ?? 0); mi = +(m[5] ?? 0); se = +(m[6] ?? 0); zone = m[7]; }
  else {
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3]; h = +(m[4] ?? 0); mi = +(m[5] ?? 0); se = +(m[6] ?? 0);
  }
  if (!realDate(y, mo, d) || h > 23 || mi > 59 || se > 59 || y < 1900 || y > 2100) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, se);
  if (!zone) return new Date(wall - TZ_OFFSET_MS);
  if (zone === 'Z') return new Date(wall);
  const zm = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
  const off = (zm[1] === '-' ? -1 : 1) * (+zm[2] * 60 + +zm[3]) * 60_000;
  return new Date(wall - off);
}

/** A calendar date «YYYY-MM-DD» (birth date, report day) from any of the formats above or a spreadsheet date. */
export function parseExtDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m && realDate(+m[1], +m[2], +m[3]) && !/[T ]\d/.test(s.slice(10))) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m && realDate(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  const t = parseExtTime(s);
  return t ? new Date(t.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10) : null;
}

export function normSex(v: unknown): 'male' | 'female' | 'unspecified' {
  const s = String(v ?? '').trim().toLowerCase();
  if (['m', 'м', 'male', 'erkak', 'муж', 'мужской', 'мужчина', '1', 'э', 'эркак'].includes(s)) return 'male';
  if (['f', 'ж', 'female', 'ayol', 'жен', 'женский', 'женщина', '2', 'аёл', 'w'].includes(s)) return 'female';
  return 'unspecified';
}

export const normPhone = (v: unknown): string | null => (v == null || v === '' ? null : normalizePhone(String(v)));
export const normPinfl = (v: unknown): string | null => { const s = String(v ?? '').replace(/\s/g, ''); return /^\d{14}$/.test(s) ? s : null; };
export const normName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
export const clip = (v: unknown, max: number): string | null => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };

/** MedPlus payment forms («Наличными», «Терминал», «Перечисление», Click, Payme…) → our method. Unknown → null (the manager maps it). */
export function guessMethod(name: string): 'cash' | 'card' | 'transfer' | null {
  const s = normName(name);
  if (/налич|naqd|нақд|cash/.test(s)) return 'cash';
  if (/термин|terminal|карт|karta|uzcard|humo|пластик|plastik|card/.test(s)) return 'card';
  if (/перечисл|перевод|банк|bank|click|payme|apelsin|uzum|o‘tkazma|otkazma|transfer|счет|счёт/.test(s)) return 'transfer';
  return null;
}

/** Service category from its name: «Анализ крови» → lab, «УЗИ» → ultrasound, «Консультация» → consultation, else procedure. */
export function guessCategory(name: string): 'consultation' | 'lab' | 'ultrasound' | 'procedure' {
  const s = normName(name);
  if (/узи|uzi|ультразв|допплер|эхо|exo/.test(s)) return 'ultrasound';
  if (/анализ|tahlil|лаборат|кров|моч|qon|siydik|биохим|гормон|пцр|тест|ифа/.test(s)) return 'lab';
  if (/консульт|konsult|приём|прием|осмотр|qabul|ko‘rik|korik/.test(s)) return 'consultation';
  return 'procedure';
}

/** Stable JSON (sorted keys) → SHA-256: an unchanged record has the same hash on every send. */
export function stableHash(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object' && !(x instanceof Date)) return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as any)[k])]));
    return x instanceof Date ? x.toISOString() : x;
  };
  return createHash('sha256').update(JSON.stringify(norm(v))).digest('hex').slice(0, 32);
}
