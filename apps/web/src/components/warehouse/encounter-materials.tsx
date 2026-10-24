'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackageOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Button, Card } from '@/components/ui';
import { qty, StatusBadge } from './common';
import { RequestModal } from './request-modal';
import { RequestDetail } from './requests';

/**
 * The doctor's visit: materials asked for and issued for this patient (by procedure order), and «Material so‘rash»,
 * which opens a request already tied to the visit, the patient and its ICD-10 codes. Patients are not billed for it.
 */
export function EncounterMaterials({ encounterId, icdDraft }: { encounterId: string; icdDraft: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['warehouse', 'encounter', encounterId], queryFn: () => api(`/warehouse/encounters/${encounterId}`).then((r) => r.data) });
  if (!q.data) return null; // the card is secondary: while it loads (or when it cannot) the visit page stays as it was
  const d = q.data;
  const byOrder = (orderId: string | null) => d.materials.filter((m: any) => (m.order_id ?? null) === orderId);
  const groups: { key: string; title: string | null; rows: any[] }[] = [
    ...d.procedures.map((o: any) => ({ key: o.id, title: o.service_name, rows: byOrder(o.id) })).filter((g: any) => g.rows.length),
    { key: 'visit', title: d.procedures.length ? t('wh.enc.forVisit') : null, rows: byOrder(null) },
  ].filter((g) => g.rows.length);
  return (
    <Card title={t('wh.enc.title')} actions={<Button size="sm" icon={<PackageOpen className="h-4 w-4" />} onClick={() => setOpen(true)}>{t('wh.enc.ask')}</Button>}>
      {!d.requests.length && !groups.length ? <p className="text-body text-slate-600">{t('wh.enc.none')}</p> : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              {g.title && <div className="text-small font-semibold text-slate-600">{g.title}</div>}
              <ul className="text-body">{g.rows.map((m: any) => <li key={`${m.item_id}:${m.order_id}`} className="flex justify-between gap-3 py-0.5"><span>{m.name}</span><span className="tabular-nums">{qty(m.qty)} {m.unit}</span></li>)}</ul>
            </div>
          ))}
          {d.requests.length > 0 && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
              {d.requests.map((r: any) => (
                <li key={r.id}><button type="button" data-no-press onClick={() => setSel(r.id)} className="flex min-h-control-sm w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-field px-2 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus">
                  <span className="min-w-0 flex-1 text-body"><b>T-{r.number}</b> · {fmtTime(r.created_at)} · {r.lines.map((l: any) => `${l.name} × ${qty(l.qty)}`).join('; ')}</span>
                  <StatusBadge status={r.status} />
                </button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {open && <RequestModal open branchId={d.branch_id} icdDraft={icdDraft} onClose={() => setOpen(false)}
        visit={{ encounter_id: d.encounter_id, icd_codes: d.icd_codes, procedures: d.procedures }} />}
      {sel && <RequestDetail id={sel} onClose={() => setSel(null)} />}
    </Card>
  );
}
