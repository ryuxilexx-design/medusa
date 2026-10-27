// Minimal XLSX writer and reader without a dependency: the zip container is built/read with node:zlib (raw deflate),
// one worksheet, shared strings, numbers as numbers, dates as Excel serials with a date format.
// Writer: every CSV export also answers as .xlsx (core/csv.ts). Reader: MedPlus «Экспорт на Excel» files and other
// spreadsheets for the file import (sync/file-import.ts): xlsx, an HTML table saved as .xls, or CSV (UTF-8 / Windows-1251).
import { deflateRawSync, inflateRawSync } from 'zlib';

// ---------------------------------------------------------------- zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive (deflate, UTF-8 names). Fixed 1980-01-01 timestamps: the same content gives the same bytes. */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const packed = deflateRawSync(f.data, { level: 6 });
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(packed.length, 18);
    lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, packed); central.push(ch, name);
    offset += lh.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export class TableReadError extends Error {
  constructor(public code: 'BAD_FILE' | 'XLS_OLD' | 'TOO_LARGE' | 'EMPTY', message: string) { super(message); }
}

/** Entries of a zip archive. Each entry is limited (a «zip bomb» stops at the limit instead of filling the memory). */
export function unzip(buf: Buffer, maxEntryBytes = 60 * 1024 * 1024): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new TableReadError('BAD_FILE', 'zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new TableReadError('BAD_FILE', 'zip: bad central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new TableReadError('BAD_FILE', 'zip: bad local header');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (usize > maxEntryBytes) throw new TableReadError('TOO_LARGE', 'zip: entry too large');
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) {
      try { out.set(name, inflateRawSync(data, { maxOutputLength: maxEntryBytes })); } catch { throw new TableReadError('BAD_FILE', 'zip: cannot inflate'); }
    } // other methods: skipped (never used by spreadsheet programs for the parts we read)
  }
  return out;
}

// ---------------------------------------------------------------- xml helpers

const xmlEsc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function xmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g, (_, e: string) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return ''; } }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[e];
  });
}
const attr = (attrs: string, name: string) => { const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs); return m ? xmlDecode(m[1]) : undefined; };
/** All text of the <t> runs inside a fragment (shared string / inline string), phonetic runs excluded. */
const runsText = (frag: string) => [...frag.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => xmlDecode(m[1] ?? '')).join('');

const colName = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

// Excel serial days: 1900 date system counted from 1899-12-30 (the 1900 leap-year bug makes this right after 1900-03-01)
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const serialOf = (y: number, mo: number, d: number, h = 0, mi = 0) => (Date.UTC(y, mo - 1, d, h, mi) - EPOCH_1900) / 86_400_000;

// ---------------------------------------------------------------- writer

/** Styles: 0 plain · 1 bold header · 2 date+time · 3 date · 4 money · 5 text that looks like a formula (quote prefix) · 6 bold (totals row). */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/><xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** A money column is recognised by its header («Summa (so‘m)», «Сумма (сум)»). */
const MONEY_HEADER = /so‘m|so'm|сўм|сум/i;
/** A plain number: no leading zero (an IKPU code or a phone keeps its digits as text), at most 15 significant digits. */
const NUMBER_TEXT = /^-?(0|[1-9]\d{0,14})(\.\d{1,6})?$/;

type Typed = { t: 'n'; v: number; s: number } | { t: 's'; v: string; s: number } | null;
function typed(v: unknown, money: boolean, bold: boolean): Typed {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return { t: 'n', v, s: money ? (bold ? 6 : 4) : 0 };
  if (typeof v === 'boolean') return { t: 's', v: v ? 'true' : 'false', s: 0 };
  if (v instanceof Date && !Number.isNaN(v.getTime())) return { t: 'n', v: (v.getTime() - EPOCH_1900) / 86_400_000, s: 2 };
  const s = String(v);
  if (NUMBER_TEXT.test(s)) return { t: 'n', v: Number(s), s: money ? (bold ? 6 : 4) : 0 };
  let m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (m) return { t: 'n', v: serialOf(+m[1], +m[2], +m[3], +m[4], +m[5]), s: 2 };
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { t: 'n', v: serialOf(+m[1], +m[2], +m[3]), s: 3 };
  // a string cell is never evaluated, but editing it would turn «=…» into a formula: keep it text (quote prefix, like «'» in CSV)
  return { t: 's', v: s, s: /^[=+\-@\t\r]/.test(s) ? 5 : bold ? 1 : 0 };
}

/**
 * One-sheet workbook: a bold, frozen header row and the rows below. Numeric text becomes a number (money columns get
 * «#,##0.00»), «YYYY-MM-DD[ HH:MM]» (Tashkent wall time, as the CSV writes it) becomes a date cell. The totals row
 * (boldLastRow) is bold.
 */
export function buildXlsx(header: string[], rows: unknown[][], opts: { sheetName?: string; boldLastRow?: boolean } = {}): Buffer {
  const strings: string[] = []; const index = new Map<string, number>();
  const si = (s: string) => { let i = index.get(s); if (i === undefined) { i = strings.length; strings.push(s); index.set(s, i); } return i; };
  const money = header.map((h) => MONEY_HEADER.test(h));
  const widths = header.map((h) => Math.min(60, Math.max(8, h.length + 2)));
  const out: string[] = [];
  const all = [header, ...rows];
  all.forEach((row, r) => {
    const isHeader = r === 0;
    const isTotals = !isHeader && r === all.length - 1 && opts.boldLastRow === true;
    const cells: string[] = [];
    row.forEach((v, c) => {
      const ty = isHeader ? (v == null || v === '' ? null : { t: 's' as const, v: String(v), s: 1 }) : typed(v, money[c] ?? false, isTotals);
      if (!ty) return;
      const ref = `${colName(c)}${r + 1}`;
      if (ty.t === 'n') cells.push(`<c r="${ref}"${ty.s ? ` s="${ty.s}"` : ''}><v>${ty.v}</v></c>`);
      else {
        cells.push(`<c r="${ref}" t="s"${ty.s ? ` s="${ty.s}"` : ''}><v>${si(ty.v)}</v></c>`);
        if (c < widths.length) widths[c] = Math.min(60, Math.max(widths[c], ty.v.length + 2));
      }
      if (ty.t === 'n' && c < widths.length) widths[c] = Math.max(widths[c], ty.s === 2 ? 17 : ty.s === 3 ? 11 : 12);
    });
    out.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${out.join('')}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  const sheetName = xmlEsc((opts.sheetName || 'Hisobot').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/sharedStrings.xml', data: sst },
  ];
  return zip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })));
}

// ---------------------------------------------------------------- reader

/** A cell read from a file: text, a number, a boolean or a date (a Date whose UTC fields are the wall-clock time). */
export type XCell = string | number | boolean | Date | null;
export type Table = XCell[][];

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = (code: string) => {
  const s = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').toLowerCase();
  return /[dmyhs]/.test(s) && !/^general$/.test(s);
};

/** The first worksheet of an .xlsx file as rows of cells (empty trailing rows dropped). */
export function readXlsx(buf: Buffer): Table {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString('utf8');
  const wb = text('xl/workbook.xml');
  if (!wb) throw new TableReadError('BAD_FILE', 'xlsx: no workbook');
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(wb);
  const rid = firstSheet ? attr(firstSheet[1], 'r:id') : undefined;
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rels = text('xl/_rels/workbook.xml.rels');
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (attr(m[1], 'Id') !== rid) continue;
      const target = attr(m[1], 'Target') ?? '';
      sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    }
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new TableReadError('BAD_FILE', 'xlsx: no worksheet');
  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => runsText(m[1] ?? ''));
  // which style indexes are dates
  const styles = text('xl/styles.xml') ?? '';
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b([^>]*)\/?>/g)) custom.set(Number(attr(m[1], 'numFmtId')), attr(m[1], 'formatCode') ?? '');
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map((m) => {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!));
  });
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900;
  const rows: Table = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = attr(rm[1], 'r');
    const rowIdx = rAttr ? Number(rAttr) - 1 : rows.length;
    const row: XCell[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1]; const body = cm[2] ?? '';
      const ref = attr(a, 'r'); const col = ref ? colIndex(ref) : next; next = col + 1;
      const t = attr(a, 't'); const s = Number(attr(a, 's') ?? 0);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val: XCell = null;
      if (t === 's') val = v === undefined ? null : shared[Number(v)] ?? null;
      else if (t === 'inlineStr') val = runsText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (t === 'str') val = v === undefined ? null : xmlDecode(v);
      else if (t === 'b') val = v === '1';
      else if (t === 'e') val = null;
      else if (t === 'd') { const d = v ? new Date(xmlDecode(v)) : null; val = d && !Number.isNaN(d.getTime()) ? d : null; }
      else if (v !== undefined && v !== '') {
        const n = Number(v);
        val = Number.isFinite(n) ? (dateStyle[s] ? new Date(Math.round(epoch + n * 86_400_000)) : n) : xmlDecode(v);
      }
      while (row.length < col) row.push(null);
      row[col] = val;
    }
    while (rows.length < rowIdx) rows.push([]);
    rows[rowIdx] = row;
  }
  return trimTable(rows);
}

const trimTable = (rows: Table): Table => {
  const out = rows.map((r) => { const x = [...r]; while (x.length && (x[x.length - 1] === null || x[x.length - 1] === '')) x.pop(); return x; });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
};

/** An HTML table saved with an .xls name (what many PHP programs call «Excel export»). */
export function readHtmlTable(html: string): Table {
  const table = /<table\b[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!table) throw new TableReadError('BAD_FILE', 'html: no table');
  const rows: Table = [];
  for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|<\/tbody>|<\/thead>)/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)].flatMap((m) => {
      const v = xmlDecode(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      const span = Math.min(50, Number(/colspan="?(\d+)/i.exec(m[1])?.[1] ?? 1));
      return [v === '' ? null : v, ...Array(Math.max(0, span - 1)).fill(null)];
    });
    rows.push(cells);
  }
  return trimTable(rows);
}

/** CSV / TSV: delimiter guessed from the first line (; , or tab), quotes per RFC 4180, UTF-8 or Windows-1251. */
/** UTF-8, or Windows-1251 when the bytes are not valid UTF-8 (a Russian Excel «CSV» or an old PHP page). */
const decodeText = (buf: Buffer) => {
  const s = buf.toString('utf8');
  return (s.includes('�') ? new TextDecoder('windows-1251').decode(buf) : s).replace(/^﻿/, '');
};

export function readCsv(buf: Buffer): Table {
  const s = decodeText(buf);
  const first = s.slice(0, s.search(/\r?\n|$/));
  const counts = [';', ',', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1]);
  const sep = counts[0][1] > 1 ? counts[0][0] : ';';
  const rows: Table = []; let row: XCell[] = []; let cell = ''; let quoted = false; let i = 0;
  const push = () => { const v = cell.trim(); row.push(v === '' ? null : v); cell = ''; };
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; i++; continue; }
    if (ch === sep) { push(); i++; continue; }
    if (ch === '\r' || ch === '\n') { push(); rows.push(row); row = []; if (ch === '\r' && s[i + 1] === '\n') i++; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { push(); rows.push(row); }
  return trimTable(rows);
}

/** Any supported table file → rows. Old binary .xls is refused with a clear code (save it as .xlsx in Excel). */
export function readTable(buf: Buffer): Table {
  if (buf.length < 4) throw new TableReadError('EMPTY', 'empty file');
  if (buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf);
  if (buf.readUInt32BE(0) === 0xd0cf11e0) throw new TableReadError('XLS_OLD', 'binary xls');
  const head = buf.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<')) { const html = decodeText(buf); if (/<table\b/i.test(html)) return readHtmlTable(html); }
  return readCsv(buf);
}
