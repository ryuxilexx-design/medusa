'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, PenLine, Printer, Undo2 } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Button, EmptyState, ErrorState, Field, Input, KeyVal, LinkButton, LoadingRows, Modal, ModalCancel, Pagination, Table, Tabs, Td, TextLink, Th, useToast } from '@/components/ui';
import { ControlledBadge, parseQty, PurposeText, qty, StatusBadge } from './common';

type Filter = 'open' | 'done' | 'all';

/** The storekeeper's queue (all requests of the branch) or a requester's own list (`mine`). */
export function RequestsList({ mine = false }: { mine?: boolean }) {
  const t = useT();
  const { branchId } = useSession();
  const [filter, setFilter] = useState<Filter>(mine ? 'all' : 'open');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['warehouse', 'requests', branchId, filter, page, mine],
    queryFn: () => api(`/warehouse/requests${qs({ branch_id: branchId || undefined, status: filter === 'all' ? undefined : filter, page, page_size: 20, mine: mine ? 1 : undefined })}`) });
  const rows: any[] = q.data?.data ?? [];
  return (
    <>
      <div className="px-3 pt-1">
        <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} items={[
          { value: 'open', label: t('wh.req.filterOpen') }, { value: 'done', label: t('wh.req.filterDone') }, { value: 'all', label: t('admin.inv.tabAll') }]} />
      </div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState compact icon={<ClipboardList />} title={t('wh.req.none')} /> : (
        <>
          <Table>
            <thead><tr><Th>{t('wh.col.doc')}</Th><Th className="hidden sm:table-cell">{t('wh.col.requester')}</Th><Th className="hidden md:table-cell">{t('wh.col.purpose')}</Th><Th className="hidden lg:table-cell">{t('wh.col.lines')}</Th><Th>{t('admin.inv.colState')}</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(r.id)}>
                <Td className="whitespace-nowrap"><TextLink tone="ink" onClick={(e) => { e.stopPropagation(); setSel(r.id); }}>T-{r.number}</TextLink>
                  <div className="text-small text-slate-600">{fmtDateTime(r.created_at)}</div><div className="text-small text-slate-800 sm:hidden">{r.requester_name}</div>
                  {/* phone / tablet: what was asked for stays visible without a sideways scroll */}
                  <div className="max-w-[16rem] whitespace-normal text-small text-slate-700 lg:hidden">{r.lines.slice(0, 2).map((l: any) => `${l.name} × ${qty(l.qty)}`).join('; ')}{r.lines.length > 2 ? ` +${r.lines.length - 2}` : ''}</div></Td>
                <Td className="hidden min-w-[9rem] sm:table-cell">{r.requester_name}<div className="text-small text-slate-600">{r.department}</div></Td>
                <Td className="hidden max-w-[18rem] text-body md:table-cell"><PurposeText r={r} /></Td>
                <Td className="hidden text-body lg:table-cell">{r.lines.slice(0, 2).map((l: any) => `${l.name} × ${qty(l.qty)}`).join('; ')}{r.lines.length > 2 ? ` +${r.lines.length - 2}` : ''}</Td>
                <Td className="whitespace-nowrap"><StatusBadge status={r.status} />{r.needs_approval && !r.approved_at && ['submitted'].includes(r.status) && <div className="mt-1 text-small font-semibold text-violet-800">{t('wh.req.waitsApproval')}</div>}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
        </>
      )}
      {sel && <RequestDetail id={sel} onClose={() => setSel(null)} />}
    </>
  );
}

/** One request: lines, what was issued from which batch, and the actions this person may take. */
export function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['warehouse', 'request', id], queryFn: () => api(`/warehouse/requests/${id}`).then((r) => r.data) });
  const [give, setGive] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [ret, setRet] = useState<any | null>(null);
  const done = (msg: MessageKey) => () => { qc.invalidateQueries({ queryKey: ['warehouse'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); toast.success(t(msg)); };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: any }) => api(`/warehouse/requests/${id}/${path}`, { method: 'POST', body: body ?? {} }),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Modal open onClose={onClose} title="…"><LoadingRows rows={3} /></Modal>;
  if (q.isError) return <Modal open onClose={onClose} title={t('wh.req.title')}><ErrorState error={q.error} onRetry={() => q.refetch()} /></Modal>;
  const r = q.data;
  const keeper = me.role === 'storekeeper' || me.role === 'manager';
  const own = r.requester_membership_id === me.membership_id;
  const openStatus = ['submitted', 'partially_issued'].includes(r.status);
  // one rule with the server: a signature is needed when the request had or now has a controlled item; whoever asked
  // for it or signed it never hands it out
  const needSign = r.needs_approval && !r.approved_at;
  const ownSign = r.needs_approval && (r.approved_by === me.membership_id || own);
  const canIssue = keeper && openStatus && !needSign && !ownSign;
  const left = (l: any) => Number(l.qty) - Number(l.issued_qty);
  const issue = () => {
    const lines = r.lines.filter((l: any) => left(l) > 0).map((l: any) => ({ line_id: l.id, qty: give[l.id] === undefined ? left(l) : parseQty(give[l.id]) }));
    if (lines.some((l: any) => !(l.qty >= 0))) { toast.error(t('admin.inv.errQty')); return; }
    act.mutate({ path: 'issue', body: { lines } }, { onSuccess: done('wh.req.issuedOk') });
  };
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={<span className="flex flex-wrap items-center gap-2">{t('wh.req.docTitle', { n: r.number })}<StatusBadge status={r.status} /></span>}
      footer={<>
        {keeper && <LinkButton href={`/print/warehouse/request/${r.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>}
        <span className="mr-auto" />
        {own && r.status === 'draft' && <Button onClick={() => act.mutate({ path: 'submit' }, { onSuccess: done('wh.req.submitted') })}>{t('wh.req.send')}</Button>}
        {own && ['draft', 'submitted'].includes(r.status) && <Button onClick={() => act.mutate({ path: 'cancel' }, { onSuccess: () => { done('wh.req.cancelled')(); onClose(); } })}>{t('wh.req.cancel')}</Button>}
        {keeper && openStatus && <Button onClick={() => setRejecting(true)}>{r.status === 'submitted' ? t('wh.req.reject') : t('wh.req.closeRest')}</Button>}
        {me.role === 'manager' && needSign && openStatus && !own && <Button variant="primary" icon={<PenLine className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ path: 'approve' }, { onSuccess: done('wh.req.approved') })}>{t('wh.req.approve')}</Button>}
        {canIssue && <Button variant="primary" loading={act.isPending} onClick={issue}>{t('wh.req.issue')}</Button>}
      </>}>
      <div className="space-y-4">
        <div className="divide-y divide-slate-100">
          <KeyVal k={t('wh.col.requester')} v={`${r.requester_name} · ${r.department}`} />
          <KeyVal k={t('wh.col.purpose')} v={<PurposeText r={r} />} />
          <KeyVal k={t('wh.col.date')} v={fmtDateTime(r.created_at)} />
          {r.approved_by_name && <KeyVal k={t('wh.req.approvedBy')} v={`${r.approved_by_name}, ${fmtDateTime(r.approved_at)}`} />}
          {r.reject_reason && <KeyVal k={t('admin.inv.reason')} v={r.reject_reason} />}
          {r.note && <KeyVal k={t('wh.req.note')} v={r.note} />}
        </div>
        {needSign && openStatus && <Alert tone="blue">{me.role === 'manager' ? t('wh.req.signHint') : t('wh.req.waitsApproval')}</Alert>}
        {keeper && openStatus && !needSign && ownSign && <Alert tone="blue">{t('wh.req.ownSign')}</Alert>}
        <Table>
          <thead><tr><Th>{t('wh.col.item')}</Th><Th right>{t('wh.col.asked')}</Th><Th right>{t('wh.col.issued')}</Th>{canIssue && <Th right>{t('wh.col.giveNow')}</Th>}</tr></thead>
          <tbody>{r.lines.map((l: any) => (
            <tr key={l.id}>
              <Td className="min-w-[10rem]">{l.name} {l.controlled && <ControlledBadge />}</Td>
              <Td right>{qty(l.qty)} {l.unit}</Td>
              <Td right>{qty(l.issued_qty)}</Td>
              {canIssue && <Td right>{left(l) > 0 ? <Input aria-label={t('wh.col.giveNow')} inputMode="decimal" className="ml-auto w-24" value={give[l.id] ?? String(left(l))} onChange={(e) => setGive((g) => ({ ...g, [l.id]: e.target.value }))} /> : '—'}</Td>}
            </tr>
          ))}</tbody>
        </Table>
        {r.movements.length > 0 && <>
          <h3 className="text-body font-bold text-slate-900">{t('wh.req.issuedFrom')}</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {r.movements.map((m: any) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1">{t(`wh.kind.${m.kind}` as MessageKey)}: {m.name} · {t('wh.col.batch')} {m.batch_no ?? '—'}{m.expiry_date ? `, ${fmtDate(m.expiry_date)}` : ''}
                  <span className="block text-small text-slate-600">{fmtDateTime(m.occurred_at)} · {m.actor_name}{m.second_signer_name ? ` + ${m.second_signer_name}` : ''}{m.voided_at ? ` · ${t('wh.voided')}: ${m.void_reason}` : ''}</span></span>
                <span className="whitespace-nowrap font-semibold tabular-nums">{m.type === 'in' ? '+' : '−'}{qty(m.quantity)}</span>
                {keeper && m.kind === 'issue' && !m.voided_at && Number(m.returned) < Number(m.quantity) &&
                  <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => setRet(m)}>{t('wh.ret.action')}</Button>}
              </li>
            ))}
          </ul>
        </>}
      </div>
      <Modal open={rejecting} onClose={() => setRejecting(false)} dirty={!!reason} title={r.status === 'submitted' ? t('wh.req.reject') : t('wh.req.closeRest')}
        footer={<><ModalCancel /><Button variant="primary" loading={act.isPending} disabled={reason.trim().length < 3}
          onClick={() => act.mutate({ path: 'reject', body: { reason } }, { onSuccess: () => { done('wh.req.rejected')(); setRejecting(false); } })}>{t('common.save')}</Button></>}>
        <Field label={t('admin.inv.reason')} required>{(fid) => <Input id={fid} data-autofocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Modal>
      {ret && <ReturnModal m={ret} onClose={() => setRet(null)} />}
    </Modal>
  );
}

/** Unused items back to the batch they came from. */
export function ReturnModal({ m, onClose }: { m: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const max = Number(m.quantity) - Number(m.returned ?? 0);
  const [q, setQ] = useState(String(max));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const n = parseQty(q);
  const qtyErr = err.qty ?? (!(n > 0) ? t('admin.inv.errQty') : n > max ? t('admin.inv.tooMuch', { qty: qty(max) }) : undefined);
  const mut = useMutation({
    mutationFn: () => api(`/warehouse/movements/${m.id}/return`, { method: 'POST', body: { qty: n, reason: reason.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouse'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); toast.success(t('wh.ret.done')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  return (
    <Modal open onClose={onClose} dirty={!!reason} title={t('wh.ret.title', { name: m.name ?? m.item_name })}
      footer={<><ModalCancel /><Button variant="primary" loading={mut.isPending} disabled={!!qtyErr || reason.trim().length < 3} onClick={() => mut.mutate()}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('admin.inv.qty', { unit: m.unit })} required error={qtyErr} hint={t('wh.ret.max', { qty: qty(max) })}>{(id) => <Input id={id} inputMode="decimal" value={q} invalid={!!qtyErr} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label={t('admin.inv.reason')} required error={err.reason}>{(id) => <Input id={id} data-autofocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={t('wh.ret.reasonPh')} />}</Field>
      </div>
    </Modal>
  );
}
