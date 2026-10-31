'use client';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { formatSom } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Field, Modal, ModalCancel, Select, Table, Td, Th, useToast } from '@/components/ui';

/**
 * Settings → Xizmatlar → «Narxlar ro‘yxatini yuklash» (docs/PRICE_LIST_IMPORT.md): a price list from MedPlus or any
 * spreadsheet. The preview stores nothing; «Yuklash» applies the confirmed columns on the server in one transaction.
 * On an error the file and the column choice stay as they were.
 */

type Outcome = 'created' | 'price_changed' | 'updated' | 'unchanged' | 'error';
type RowOutcome = { row: number; outcome: Outcome; name: string | null; code: string | null; old_price?: number | null; price?: number | null; error?: string };
type Counts = Record<Outcome, number> & { total: number };
type Preview = { header_row: number; headers: string[]; mapping: Record<string, number>; fields: { key: string; required: boolean }[]; counts: Counts | null; rows: RowOutcome[]; errors: RowOutcome[] };

const MP = { mp: 'MedPlus' };
const TONE: Record<Outcome, 'green' | 'blue' | 'gray' | 'red'> = { created: 'green', price_changed: 'blue', updated: 'blue', unchanged: 'gray', error: 'red' };

export function PriceImportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, number> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const form = (m: Record<string, number> | null) => {
    const f = new FormData(); f.append('file', file!);
    if (m) f.append('mapping', JSON.stringify(m));
    return f;
  };
  const read = useMutation({
    mutationFn: (m: Record<string, number> | null) => api<{ data: Preview }>('/services/import/preview', { method: 'POST', body: form(m) }),
    onSuccess: (r) => { setPreview(r.data); setMapping(r.data.mapping); },
    onError: (e) => toast.error(e),
  });
  const run = useMutation({
    mutationFn: () => api<{ data: { counts: Counts } }>('/services/import', { method: 'POST', body: form(mapping) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['services'] });
      toast.success(t('settings.priceImport.done', { created: r.data.counts.created, changed: r.data.counts.price_changed }));
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  const choose = (key: string, col: number) => {
    const next = { ...(mapping ?? {}) };
    if (col < 0) delete next[key]; else next[key] = col;
    setMapping(next);
    const missing = preview?.fields.some((f) => f.required && next[f.key] === undefined);
    if (!missing) read.mutate(next); // the outcomes follow the user's columns
  };
  const missing = preview ? preview.fields.filter((f) => f.required && mapping?.[f.key] === undefined) : [];
  const c = preview?.counts;
  const changes = c ? c.created + c.price_changed + c.updated : 0;
  const errText = (code?: string) => (code ? t(`settings.priceImport.err.${code}` as MessageKey, MP) : '');
  const result = (r: RowOutcome) => (r.outcome === 'error'
    ? <span className="text-small text-red-700">{errText(r.error)}</span>
    : <Badge tone={TONE[r.outcome]}>{t(`settings.priceImport.out.${r.outcome}` as MessageKey)}</Badge>);

  return (
    <Modal open onClose={onClose} dirty={!!file && !run.isPending} width="max-w-3xl" title={t('settings.priceImport.open')}
      footer={<><ModalCancel /><Button variant="primary" disabled={!preview || missing.length > 0 || changes === 0 || read.isPending} loading={run.isPending} onClick={() => run.mutate()} data-testid="price-import-run">{t('settings.priceImport.run')}</Button></>}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label={t('settings.priceImport.file', { formats: 'XLSX, CSV · 10 MB · 5 000' })} className="min-w-0 sm:flex-1">
            {(id) => <input id={id} ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.txt" data-testid="price-import-file" data-autofocus
              className="block min-h-control w-full rounded-field border border-slate-300 bg-white px-3 py-2 text-body text-slate-800 file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-4 file:py-1.5 file:text-small file:font-semibold file:text-slate-800"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setMapping(null); }} />}
          </Field>
          <Button icon={<FileSpreadsheet className="h-4 w-4" />} disabled={!file} loading={read.isPending} onClick={() => read.mutate(null)} data-testid="price-import-read">{t('settings.priceImport.read')}</Button>
        </div>

        {preview && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h3 className="text-body font-bold text-slate-900">{t('settings.priceImport.columns')}</h3>
              <span className="text-small text-slate-600">{t('settings.priceImport.headerRow', { n: preview.header_row })}</span>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {preview.fields.map((f) => (
                <Field key={f.key} label={t(`settings.priceImport.field.${f.key}` as MessageKey)} required={f.required}>
                  {(id) => (
                    <Select id={id} size="sm" value={mapping?.[f.key] ?? -1} invalid={f.required && mapping?.[f.key] === undefined} disabled={run.isPending}
                      onChange={(e) => choose(f.key, Number(e.target.value))}>
                      <option value={-1}>{t('settings.priceImport.notUsed')}</option>
                      {preview.headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                    </Select>
                  )}
                </Field>
              ))}
            </div>
          </section>
        )}

        {preview && c && (
          <section className="flex flex-col gap-3" aria-live="polite" data-testid="price-import-preview">
            <div className="flex flex-wrap gap-2">
              {(['created', 'price_changed', 'updated', 'unchanged', 'error'] as Outcome[]).filter((k) => k !== 'updated' || c.updated > 0).map((k) => (
                <Badge key={k} tone={TONE[k]}>{t(`settings.priceImport.res.${k}` as MessageKey, { n: c[k] })}</Badge>
              ))}
            </div>
            {preview.errors.length > 0 && (
              <Alert tone="red" title={t('settings.priceImport.errorsTitle')}>
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {preview.errors.map((e) => (
                    <li key={e.row} className="text-small"><span className="tabular-nums font-semibold">{t('settings.priceImport.colRow')} {e.row}</span>{e.name ? ` · ${e.name}` : ''} — {errText(e.error)}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {preview.rows.length > 0 && (
              <div className="overflow-hidden rounded-field border border-slate-200">
                <p className="border-b border-slate-200 px-3 py-2 text-small text-slate-600">{t('settings.priceImport.firstRows', { n: preview.rows.length })}</p>
                <div className="max-h-80 overflow-y-auto">
                  <Table>
                    <thead><tr>
                      <Th className="hidden sm:table-cell">{t('settings.priceImport.colRow')}</Th><Th>{t('settings.priceImport.colService')}</Th>
                      <Th right>{t('settings.priceImport.colPrice')}</Th><Th className="hidden sm:table-cell">{t('settings.priceImport.colResult')}</Th>
                    </tr></thead>
                    <tbody>{preview.rows.map((r) => (
                      <tr key={r.row}>
                        <Td className="hidden tabular-nums text-slate-600 sm:table-cell">{r.row}</Td>
                        <Td className="min-w-[9rem]"><span className="font-medium text-slate-900">{r.name ?? '—'}</span>{r.code && <span className="block text-small text-slate-600">{r.code}</span>}
                          <div className="mt-1 sm:hidden">{result(r)}</div></Td>
                        <Td right className="whitespace-nowrap tabular-nums text-slate-800">
                          {r.outcome === 'price_changed' && r.old_price != null && <span className="block text-small text-slate-500 line-through">{formatSom(r.old_price)}</span>}
                          {r.price != null ? formatSom(r.price) : '—'}
                        </Td>
                        <Td className="hidden sm:table-cell">{result(r)}</Td>
                      </tr>
                    ))}</tbody>
                  </Table>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
