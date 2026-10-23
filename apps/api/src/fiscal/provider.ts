// Fiscal receipts (online cash register / ОФД): one provider per clinic, one fiscal_receipts row per payment or
// refund. A provider never blocks the sale: whatever it throws is recorded as status «failed» with the error,
// and the cashier or the worker finishes the receipt later.
//
//   manual — parallel mode: the clinic's certified KKM prints the receipt, the cashier records its number here
//            (row starts «pending», POST /payments/:id/fiscal makes it «issued»).
//   none   — no fiscalisation (demo clinics): the row is «skipped».
//   <other> — an automatic provider (none wired yet): the row starts «pending» and fiscal/worker.ts retries it.
import { Q } from '../core/db';
import { config } from '../core/config';

export type FiscalKind = 'sale' | 'refund';
export type FiscalStatus = 'pending' | 'issued' | 'failed' | 'skipped';

/** What a provider needs to build a receipt. Money is integer tiyin; items carry the catalogue's fiscal attributes. */
export type FiscalRequest = {
  tenantId: string;
  branchId: string;
  kind: FiscalKind;
  paymentId?: string;
  refundId?: string;
  amount: number;
  method: 'cash' | 'card' | 'transfer';
  items: { description: string; quantity: number; line_total: number; ikpu_code: string | null; vat_percent: number | null; vat_exempt: boolean; package_code: string | null }[];
};

/** A provider's answer. `pending` = someone (cashier or worker) still has to finish it. */
export type FiscalResult =
  | { status: 'pending' | 'skipped' }
  | { status: 'issued'; receipt_number: string; fiscal_sign?: string | null; qr_url?: string | null; terminal_id?: string | null }
  | { status: 'failed'; error: string };

export interface FiscalProvider {
  readonly name: string;
  /** true = a machine finishes the receipt (worker retries pending rows); false = a person does (manual) or nobody (none). */
  readonly automatic: boolean;
  issueSale(req: FiscalRequest): Promise<FiscalResult>;
  issueRefund(req: FiscalRequest): Promise<FiscalResult>;
}

/** Parallel mode: the certified KKM is outside Med.uz.ai; the cashier types the receipt number in afterwards. */
export class ManualProvider implements FiscalProvider {
  readonly name = 'manual';
  readonly automatic = false;
  async issueSale(): Promise<FiscalResult> { return { status: 'pending' }; }
  async issueRefund(): Promise<FiscalResult> { return { status: 'pending' }; }
}

/** Demo clinics: nothing is fiscalised and nothing is owed. */
export class NoneProvider implements FiscalProvider {
  readonly name = 'none';
  readonly automatic = false;
  async issueSale(): Promise<FiscalResult> { return { status: 'skipped' }; }
  async issueRefund(): Promise<FiscalResult> { return { status: 'skipped' }; }
}

export type ProviderRegistry = Record<string, FiscalProvider>;
export const DEFAULT_PROVIDERS: ProviderRegistry = { manual: new ManualProvider(), none: new NoneProvider() };

/** The clinic's provider name: its own override, otherwise the deployment default (FISCAL_PROVIDER). */
export async function fiscalProviderName(q: Q, tenantId: string): Promise<string> {
  const r = (await q.query(`SELECT fiscal_provider FROM tenants WHERE id = $1`, [tenantId])).rows[0];
  return (r?.fiscal_provider as string | null) || config.fiscal.provider;
}

/** Effective VAT of a service line: exempt → null («без НДС»), otherwise its own percent or the 12 % default. */
export const effectiveVat = (s: { vat_percent: number | null; vat_exempt: boolean }) => (s.vat_exempt ? null : s.vat_percent ?? 12);

/** Invoice lines with the catalogue's fiscal attributes (what a receipt is made of). */
export async function loadInvoiceItems(q: Q, invoiceId: string): Promise<FiscalRequest['items']> {
  return (await q.query(
    `SELECT it.description, it.quantity, it.line_total, s.ikpu_code, s.vat_percent, s.vat_exempt, s.package_code
       FROM invoice_items it LEFT JOIN services s ON s.id = it.service_id WHERE it.invoice_id = $1 ORDER BY it.position`, [invoiceId])).rows
    .map((r: any) => ({ ...r, quantity: Number(r.quantity), line_total: Number(r.line_total), vat_exempt: !!r.vat_exempt }));
}

export const FISCAL_COLS = `f.id, f.kind, f.provider, f.status, f.receipt_number, f.fiscal_sign, f.qr_url, f.terminal_id, f.issued_at, f.entered_by_name, f.error, f.created_at`;

/**
 * Creates the fiscal row for a payment or refund inside the caller's transaction. The provider is called with
 * the invoice lines; a thrown error becomes a «failed» row (the sale itself is never rolled back for it).
 * Returns the stored row.
 */
export async function recordFiscal(q: Q, req: Omit<FiscalRequest, 'items'> & { invoiceId: string }, providers: ProviderRegistry = DEFAULT_PROVIDERS) {
  const name = await fiscalProviderName(q, req.tenantId);
  const items = await loadInvoiceItems(q, req.invoiceId);
  const full: FiscalRequest = { ...req, items };
  const provider = providers[name];
  let result: FiscalResult;
  if (!provider) {
    // an automatic provider configured by name but not wired in this build: leave it to the worker (it reports the gap)
    result = { status: 'pending' };
  } else {
    try {
      result = req.kind === 'sale' ? await provider.issueSale(full) : await provider.issueRefund(full);
    } catch (e) {
      result = { status: 'failed', error: String((e as Error)?.message || e).slice(0, 500) };
    }
  }
  const issued = result.status === 'issued' ? result : null;
  const row = (await q.query(
    `INSERT INTO fiscal_receipts (tenant_id, kind, payment_id, refund_id, provider, status, receipt_number, fiscal_sign, qr_url, terminal_id, issued_at, error, attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $6 = 'issued' THEN demo_now() END, $11, CASE WHEN $6 IN ('issued','failed') THEN 1 ELSE 0 END)
     RETURNING id, kind, provider, status, receipt_number, fiscal_sign, qr_url, terminal_id, issued_at, entered_by_name, error, created_at`,
    [req.tenantId, req.kind, req.paymentId ?? null, req.refundId ?? null, name, result.status,
      issued?.receipt_number ?? null, issued?.fiscal_sign ?? null, issued?.qr_url ?? null, issued?.terminal_id ?? null,
      result.status === 'failed' ? result.error : null])).rows[0];
  return row;
}
