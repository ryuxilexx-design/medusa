'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, FileEdit, Lock, XCircle } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Badge, type Tone } from '@/components/ui';

/** Quantities: grouped digits, decimals only when there are any («12», «2,5»). */
export const qty = (v: unknown) => Number(v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/ /g, ' ');
/** Parses a typed quantity («2,5» or «2.5»); NaN when it is not a number. */
export const parseQty = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/\s/g, '').replace(',', '.')));

export type CatalogItem = { id: string; name: string; unit: string; category: string; controlled: boolean; available: string };
/** Active items of a branch with the usable (not expired) quantity — what a requester may pick. */
export function useCatalog(branchId: string | undefined) {
  return useQuery({ queryKey: ['warehouse', 'catalog', branchId], enabled: !!branchId,
    queryFn: () => api(`/warehouse/catalog?branch_id=${branchId}`).then((r) => r.data as CatalogItem[]) });
}

const STATUS: Record<string, { tone: Tone; icon: React.ReactNode }> = {
  draft: { tone: 'gray', icon: <FileEdit className="h-3.5 w-3.5" /> },
  submitted: { tone: 'yellow', icon: <Clock className="h-3.5 w-3.5" /> },
  partially_issued: { tone: 'blue', icon: <Clock className="h-3.5 w-3.5" /> },
  issued: { tone: 'green', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  rejected: { tone: 'red', icon: <XCircle className="h-3.5 w-3.5" /> },
  cancelled: { tone: 'gray', icon: <XCircle className="h-3.5 w-3.5" /> },
  pending: { tone: 'yellow', icon: <Clock className="h-3.5 w-3.5" /> },
  approved: { tone: 'green', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  open: { tone: 'yellow', icon: <Clock className="h-3.5 w-3.5" /> },
};
/** A document state: word + icon + colour (never colour alone). */
export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const s = STATUS[status] ?? STATUS.draft;
  return <Badge tone={s.tone} icon={s.icon}>{t(`wh.status.${status}` as MessageKey)}</Badge>;
}
export function ControlledBadge() {
  const t = useT();
  return <Badge tone="violet" icon={<Lock className="h-3.5 w-3.5" />}>{t('wh.controlled')}</Badge>;
}
/** Expiry date with a red «expired» / amber «soon» mark. */
export function Expiry({ date, today }: { date: string | null; today: string }) {
  const t = useT();
  if (!date) return <span className="text-slate-600">—</span>;
  const d = String(date).slice(0, 10);
  const days = Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  if (days < 0) return <span className="inline-flex items-center gap-1 font-semibold text-red-700"><AlertTriangle className="h-4 w-4" />{fmtDate(d)} · {t('wh.expired')}</span>;
  if (days <= 90) return <span className="font-semibold text-amber-800">{fmtDate(d)} · {t('wh.daysLeft', { n: days })}</span>;
  return <span>{fmtDate(d)}</span>;
}
/** What the items were for, in one short line (patient name/number, procedure or department). */
export function PurposeText({ r }: { r: any }) {
  const t = useT();
  if (r.purpose === 'department') return <span>{t('wh.purpose.department')}: {r.department}</span>;
  const who = r.last_name ? `${r.last_name} ${r.first_name} #${r.patient_number}` : '';
  return <span>{r.purpose === 'procedure' ? `${r.order_service ?? t('wh.purpose.procedure')} · ` : ''}{who}{r.icd_codes?.length ? ` · ${r.icd_codes.join(', ')}` : ''}</span>;
}
export const CATEGORIES = ['medicine', 'consumable', 'reagent', 'instrument', 'other'] as const;
export const STORAGE = ['room', 'fridge', 'freezer'] as const;
