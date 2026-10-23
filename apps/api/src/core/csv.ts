// CSV exports: one bounded period (≤ 1 year), Tashkent time, formula-injection-safe cells, UTF-8 BOM for Excel.
import { Response } from 'express';
import { addDays, TZ_OFFSET_MS } from './clock';
import { invalid } from './errors';
import { isDate } from './validate';

/** A cell starting with = + - @ or a tab/CR would be executed by a spreadsheet: it gets a leading apostrophe. */
export const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
/** «2026-10-18 14:05» in Asia/Tashkent. */
export const csvTime = (d: Date | string | null | undefined) => (d ? new Date(new Date(d).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') : '');
export const csvDate = (d: Date | string | null | undefined) => (d ? new Date(new Date(d).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10) : '');
/** Tiyin → «1234.50» (a number cell, never grouped). */
export const csvSom = (tiyin: unknown) => (Number(tiyin ?? 0) / 100).toFixed(2);

/** An export is built in memory: «all time» would stall the server for everyone, so a period of at most a year is required. */
export function csvPeriod(q: any): { from: string; to: string } {
  if (!isDate(q.from) || !isDate(q.to)) throw invalid({ from: 'Davrni tanlang' });
  if (q.from > q.to || addDays(q.from, 366) < q.to) throw invalid({ from: 'Eksport davri 1 yildan oshmasin' });
  return { from: q.from, to: q.to };
}

export function sendCsv(res: Response, filename: string, header: string[], rows: unknown[][]) {
  const lines = [header.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + lines.join('\r\n'));
}
