// CSV exports: one bounded period (≤ 1 year), Tashkent time, formula-injection-safe cells, UTF-8 BOM for Excel.
import { Response } from 'express';
import { addDays, TZ_OFFSET_MS } from './clock';
import { invalid } from './errors';
import { isDate } from './validate';
import { buildXlsx } from './xlsx';

/**
 * A cell starting with = + - @ or a tab/CR would be executed by a spreadsheet: it gets a leading apostrophe. A plain
 * negative number («-12.50», a quantity out or a refund) is not a formula and stays a number (B7, audit 2026-10-25).
 */
export const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
/** «2026-10-18 14:05» in Asia/Tashkent. */
export const csvTime = (d: Date | string | null | undefined) => (d ? new Date(new Date(d).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') : '');
export const csvDate = (d: Date | string | null | undefined) => (d ? new Date(new Date(d).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10) : '');
/** Tiyin → «1234.50» (a number cell, never grouped). */
export const csvSom = (tiyin: unknown) => (Number(tiyin ?? 0) / 100).toFixed(2);

/** The longest period of a report or an export, in calendar days counting both ends (a leap year fits). */
export const MAX_PERIOD_DAYS = 366;
/** from ≤ to and at most MAX_PERIOD_DAYS days from the first to the last day, both included. */
export const periodFits = (from: string, to: string) => from <= to && to <= addDays(from, MAX_PERIOD_DAYS - 1);

/** An export is built in memory: «all time» would stall the server for everyone, so a period of at most a year is required. */
export function csvPeriod(q: any): { from: string; to: string } {
  if (!isDate(q.from) || !isDate(q.to)) throw invalid({ from: 'Davrni tanlang' });
  if (!periodFits(q.from, q.to)) throw invalid({ from: 'Eksport davri 1 yildan oshmasin' });
  return { from: q.from, to: q.to };
}

/**
 * Most rows one export may hold. More rows are refused (422: «narrow the period») instead of being cut silently —
 * a truncated ledger looks complete. `CSV_MAX_ROWS` lowers it (tests).
 */
export const csvMaxRows = () => Number(process.env.CSV_MAX_ROWS) || 100_000;
export function assertCsvRows(n: number, max = csvMaxRows()) {
  if (n > Math.min(max, csvMaxRows())) throw invalid({ from: `Eksportda ${Math.min(max, csvMaxRows())} qatordan ko‘p bo‘ladi — davrni qisqartiring` });
}

/** A totals row starts with one of these labels (Uzbek, Uzbek Cyrillic, Russian; the reorder list's estimate). */
const TOTALS_LABEL = /^(Jami|Жами|Итого|Всего|Taxminiy summa|Тахминий сумма|Ориентировочная сумма)\b/;

/**
 * Sends an export. Every export route answers as `…csv` and `…xlsx` (same columns, same totals row, same period limit):
 * the route path decides the format, so one handler serves both (core/xlsx.ts).
 */
export function sendCsv(res: Response, filename: string, header: string[], rows: unknown[][]) {
  if (/\.xlsx$/i.test(String((res as any).req?.path ?? ''))) {
    const last = rows[rows.length - 1];
    const xlsx = buildXlsx(header, rows, { boldLastRow: !!last && TOTALS_LABEL.test(String(last[0] ?? '')) });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/\.csv$/i, '')}.xlsx"`);
    res.send(xlsx);
    return;
  }
  const lines = [header.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + lines.join('\r\n'));
}
