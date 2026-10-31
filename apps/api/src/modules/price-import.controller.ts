// Settings → Xizmatlar → «Narxlar ro‘yxatini yuklash» (docs/PRICE_LIST_IMPORT.md). Manager only. The preview reads
// the file and the catalogue and stores nothing; the import repeats the same plan inside one transaction.
import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, invalid } from '../core/errors';
import { audit } from '../core/audit';
import { TableReadError } from '../core/xlsx';
import { readUpload } from '../sync/sync.controller';
import { applyPlan, cleanMapping, ERRORS_LISTED, loadServices, parseRows, Plan, planImport, PRICE_FIELDS, PRICE_IMPORT_MAX_BYTES, PRICE_IMPORT_MAX_ROWS, readPriceList, ROWS_LISTED } from './price-import';

@Controller('services/import')
export class PriceImportController {
  constructor(private db: Db) {}

  /** Step 1: the guessed (or the given) column mapping and what every row would do. Nothing is written. */
  @Roles('manager') @Post('preview') @HttpCode(200)
  async preview(@CurrentCtx() ctx: Ctx, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { file, body } = await readUpload(req, res);
    const { parsed, mapping, rows, missing } = this.prepare(file, body, false);
    const head = { header_row: parsed.headerRow + 1, headers: parsed.headers, guess: parsed.guess, mapping, fields: PRICE_FIELDS.map((f) => ({ key: f.key, required: !!f.required })) };
    // headers we could not recognise: the person picks the name/price columns first (no outcomes yet)
    if (missing.length) return { data: { ...head, missing, counts: null, rows: [], errors: [] } };
    const plan = planImport(rows, await loadServices(this.db.pool, ctx.tenantId));
    return { data: { ...head, missing, ...this.summary(plan) } };
  }

  /** Step 2: the confirmed mapping; valid rows are applied in one transaction, error rows are skipped and listed. */
  @Roles('manager') @Post() @HttpCode(200)
  async import(@CurrentCtx() ctx: Ctx, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { file, body } = await readUpload(req, res);
    const { mapping, rows } = this.prepare(file, body, true);
    const plan = await this.db.tx(async (c) => {
      await c.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [ctx.tenantId]); // the service code generator, as in createService
      const p = planImport(rows, await loadServices(c, ctx.tenantId, true));
      await applyPlan(c, ctx.tenantId, p);
      const n = p.counts;
      await audit(c, ctx, 'service.import', 'service', null,
        `Narxlar ro‘yxati yuklandi: ${n.total} qator — ${n.created} yangi, ${n.price_changed} narx o‘zgardi, ${n.updated} boshqa maydon, ${n.unchanged} o‘zgarishsiz, ${n.error} xato`);
      return p;
    });
    return { data: { mapping, ...this.summary(plan) } };
  }

  private prepare(file: { buffer: Buffer; size: number } | undefined, body: Record<string, string>, needMapping: boolean) {
    if (!file || !file.size) throw invalid({ file: 'Faylni tanlang' });
    if (file.size > PRICE_IMPORT_MAX_BYTES) throw coded(413, 'FILE_TOO_LARGE', 'api.sync.fileTooLarge', { mb: PRICE_IMPORT_MAX_BYTES / 1024 / 1024 });
    let parsed: ReturnType<typeof readPriceList>;
    try { parsed = readPriceList(file.buffer); } catch (e) {
      if (e instanceof TableReadError) throw e.code === 'XLS_OLD' ? coded(422, 'XLS_OLD', 'api.sync.xlsOld', { app: 'Excel', fmt: 'XLSX' }) : coded(422, 'BAD_FILE', 'api.sync.badFile');
      throw e;
    }
    const dataRows = parsed.table.slice(parsed.headerRow + 1).filter((r) => r.some((c) => c != null && c !== '')).length;
    if (dataRows > PRICE_IMPORT_MAX_ROWS) throw coded(413, 'TOO_MANY_ROWS', 'api.sync.tooManyRows', { n: '5 000' });
    let mapping = parsed.guess;
    if (body.mapping) {
      let raw: unknown; try { raw = JSON.parse(body.mapping); } catch { raw = null; }
      const m = cleanMapping(raw, parsed.width);
      if (!m) throw invalid({ mapping: 'Ustunlar noto‘g‘ri' });
      mapping = m;
    } else if (needMapping) throw invalid({ mapping: 'Ustunlar noto‘g‘ri' });
    const missing = PRICE_FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.key);
    // a guess without the name/price columns is answered (the person chooses them); a chosen mapping without them is not
    if (missing.length && (needMapping || body.mapping)) throw new AppError(422, 'VALIDATION', 'Maydonlarni tekshiring', Object.fromEntries(missing.map((k) => [k, 'Ustunni tanlang'])));
    const rows = missing.length ? [] : parseRows(parsed.table, parsed.headerRow, mapping);
    return { parsed, mapping, rows, missing };
  }

  private summary(plan: Plan) {
    return {
      counts: plan.counts,
      rows: plan.outcomes.slice(0, ROWS_LISTED),
      errors: plan.outcomes.filter((o) => o.outcome === 'error').slice(0, ERRORS_LISTED),
    };
  }
}
