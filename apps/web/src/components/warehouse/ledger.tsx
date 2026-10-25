'use client';
// Warehouse read views: movement ledger, controlled-substance register, expiring lots, fridge log, consumption reports.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, History, Pencil, Plus, Printer, Thermometer } from 'lucide-react';
import { COLD_DEVICE_RANGE, type MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { addDays, fmtDateTime, formatSom } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useI18n, useT } from '@/lib/i18n';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, Input, KeyVal, LinkButton, LoadingRows, Modal, ModalCancel, Pagination, Select, Table, Tabs, Td, Th, Toolbar, useToast } from '@/components/ui';
import { DateRange } from '@/components/date-range';
import { CsvLink } from '@/components/finance-extra';
import { ControlledBadge, Expiry, PurposeText, qty } from './common';
import { useDocBranch } from './docs';

const KINDS = ['receipt', 'issue', 'return', 'writeoff', 'adjust', 'void', 'legacy'] as const;

function usePeriod(days = 30) {
  const { me } = useSession();
  const [from, setFrom] = useState(addDays(me.today, -(days - 1)));
  const [to, setTo] = useState(me.today);
  return { from, to, setFrom, setTo };
}

// ------------------------------------------------------------------ ledger
export function MovementsTab() {
  const t = useT();
  const { me, branchId } = useSession();
  const p = usePeriod();
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<any | null>(null);
  const f = { from: p.from, to: p.to, branch_id: branchId || undefined, kind: kind || undefined };
  const q = useQuery({ queryKey: ['warehouse', 'movements', f, page], queryFn: () => api(`/warehouse/movements${qs({ ...f, page, page_size: 25 })}`) });
  const rows: any[] = q.data?.data ?? [];
  return (
    <>
      <Toolbar actions={<CsvLink href={`/api/v1/warehouse/movements.csv${qs(f)}`} />}>
        <DateRange from={p.from} to={p.to} onFrom={(v) => { p.setFrom(v); setPage(1); }} onTo={(v) => { p.setTo(v); setPage(1); }} />
        <Select aria-label={t('wh.col.kind')} className="sm:w-52" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          <option value="">{t('wh.mv.allKinds')}</option>{KINDS.map((k) => <option key={k} value={k}>{t(`wh.kind.${k}` as MessageKey)}</option>)}
        </Select>
      </Toolbar>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState compact icon={<History />} title={t('wh.mv.none')} /> : (
        <>
          <Table>
            <thead><tr><Th className="hidden sm:table-cell">{t('wh.col.date')}</Th><Th>{t('wh.col.item')}</Th><Th right>{t('wh.col.qty')}</Th><Th className="hidden lg:table-cell">{t('wh.col.whoFor')}</Th><Th right className="hidden sm:table-cell">{t('wh.col.sum')}</Th>{me.role === 'manager' && <Th className="hidden sm:table-cell"><span className="sr-only">{t('wh.mv.void')}</span></Th>}</tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id} className={m.voided_at ? 'text-slate-500 line-through decoration-slate-400' : ''}>
                <Td className="hidden whitespace-nowrap text-body sm:table-cell">{fmtDateTime(m.occurred_at)}<div className="text-small text-slate-600">{t(`wh.kind.${m.kind}` as MessageKey)}{m.doc_no ? ` · ${m.doc_no}` : ''}</div></Td>
                <Td className="min-w-[9rem]">{m.item_name}{m.controlled && <> <ControlledBadge /></>}<div className="text-small text-slate-600">{t('wh.col.batch')} {m.batch_no ?? '—'}</div>
                  {/* phone: date, document, who took it and the sum stay in the row (no sideways scroll) */}
                  <div className="text-small text-slate-600 sm:hidden">{fmtDateTime(m.occurred_at)} · {t(`wh.kind.${m.kind}` as MessageKey)}{m.doc_no ? ` ${m.doc_no}` : ''}</div>
                  <div className="text-small text-slate-800 lg:hidden">{m.receiver_name ?? m.actor_name}{m.purpose ? <> · <PurposeText r={m} /></> : null}</div>
                  {m.voided_at && <div className="text-small no-underline lg:hidden">{t('wh.voided')}: {m.void_reason}</div>}
                  {me.role === 'manager' && ['receipt', 'issue', 'return'].includes(m.kind) && !m.voided_at && <Button size="sm" variant="ghost" className="-ml-3 sm:hidden" icon={<Ban className="h-4 w-4" />} onClick={() => setVoiding(m)}>{t('wh.mv.void')}</Button>}</Td>
                <Td right><span className={m.type === 'in' ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-900'}>{m.type === 'in' ? '+' : '−'}{qty(m.quantity)}</span> <span className="text-small text-slate-600">{m.unit}</span>
                  <div className="text-small text-slate-600 sm:hidden">{formatSom(m.value)}</div></Td>
                <Td className="hidden max-w-[20rem] text-body lg:table-cell">{m.receiver_name ? <>{m.receiver_name}<div className="text-small text-slate-600">{m.purpose ? <PurposeText r={m} /> : null}</div></> : <span className="text-slate-600">{m.actor_name}</span>}
                  {m.voided_at && <div className="text-small no-underline">{t('wh.voided')}: {m.void_reason}</div>}</Td>
                <Td right className="hidden sm:table-cell">{formatSom(m.value)}</Td>
                {me.role === 'manager' && <Td className="hidden w-px sm:table-cell">{['receipt', 'issue', 'return'].includes(m.kind) && !m.voided_at && <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setVoiding(m)}>{t('wh.mv.void')}</Button>}</Td>}
              </tr>
            ))}</tbody>
          </Table>
          <Pagination page={page} pageSize={25} total={q.data.meta.total} onPage={setPage} />
        </>
      )}
      {voiding && <VoidModal m={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

function VoidModal({ m, onClose }: { m: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const mut = useMutation({
    mutationFn: () => api(`/warehouse/movements/${m.id}/void`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouse'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); toast.success(t('wh.mv.voided')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields.reason); toast.error(e); },
  });
  return (
    <Modal open onClose={onClose} dirty={!!reason} title={t('wh.mv.voidTitle', { name: m.item_name })}
      footer={<><ModalCancel /><Button variant="primary" loading={mut.isPending} disabled={reason.trim().length < 5} onClick={() => mut.mutate()}>{t('wh.mv.void')}</Button></>}>
      <p className="mb-3 text-body text-slate-800">{t('wh.mv.voidText')}</p>
      <Field label={t('admin.inv.reason')} required error={err}>{(id) => <Input id={id} data-autofocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ controlled register
export function ControlledTab() {
  const t = useT();
  const { branchId } = useSession();
  const p = usePeriod(31);
  const items = useQuery({ queryKey: ['warehouse', 'stock', branchId, 'controlled'], queryFn: () => api(`/warehouse/stock${qs({ branch_id: branchId || undefined, controlled: 1 })}`).then((r) => r.data as any[]) });
  const [sel, setSel] = useState('');
  const id = sel || items.data?.[0]?.id || '';
  const j = useQuery({ queryKey: ['warehouse', 'journal', id, p.from, p.to], enabled: !!id, queryFn: () => api(`/warehouse/controlled/${id}${qs({ from: p.from, to: p.to })}`).then((r) => r.data) });
  if (items.isLoading) return <LoadingRows />;
  if (!items.data?.length) return <EmptyState compact title={t('wh.ctl.none')} />;
  return (
    <>
      <Toolbar actions={<LinkButton href={`/print/warehouse/controlled/${id}${qs({ from: p.from, to: p.to })}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>}>
        <Select aria-label={t('wh.col.item')} className="sm:w-72" value={id} onChange={(e) => setSel(e.target.value)}>
          {items.data.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <DateRange from={p.from} to={p.to} onFrom={p.setFrom} onTo={p.setTo} />
      </Toolbar>
      {j.isLoading ? <LoadingRows /> : j.isError ? <ErrorState error={j.error} onRetry={() => j.refetch()} /> : <>
        <div className="grid grid-cols-1 divide-y divide-slate-100 px-5 py-2 sm:grid-cols-3 sm:divide-y-0">
          <KeyVal k={t('wh.ctl.opening')} v={`${qty(j.data.opening_balance)} ${j.data.item.unit}`} />
          <KeyVal k={t('wh.ctl.turnover', { in: qty(j.data.period_in), out: qty(j.data.period_out) })} v="" />
          <KeyVal k={t('wh.ctl.closing')} v={`${qty(j.data.closing_balance)} ${j.data.item.unit}`} />
        </div>
        <JournalTable entries={j.data.entries} />
      </>}
    </>
  );
}
export function JournalTable({ entries, print = false }: { entries: any[]; print?: boolean }) {
  const t = useT();
  if (!entries.length) return <EmptyState compact title={t('wh.mv.none')} />;
  const cell = print ? 'border border-slate-400 px-1.5 py-1 align-top' : '';
  // on paper the columns share the sheet width (no minimum widths, the table must stay inside A4)
  const Row = ({ children, className }: { children: React.ReactNode; className?: string }) => print ? <td className={`${cell} ${(className ?? '').replace(/min-w-\S+/g, '')}`}>{children}</td> : <Td className={className}>{children}</Td>;
  const Head = ({ children, right }: { children: React.ReactNode; right?: boolean }) => print ? <th className={`${cell} text-left font-semibold ${right ? 'text-right' : ''}`}>{children}</th> : <Th right={right}>{children}</Th>;
  const body = (
    <>
      <thead><tr><Head>№</Head><Head>{t('wh.col.date')}</Head><Head>{t('wh.col.doc')}</Head><Head>{t('wh.col.batch')}</Head><Head right>{t('wh.ctl.in')}</Head><Head right>{t('wh.ctl.out')}</Head><Head right>{t('wh.ctl.balance')}</Head><Head>{t('wh.ctl.patient')}</Head><Head>{t('wh.ctl.signatures')}</Head></tr></thead>
      <tbody>{entries.map((e, i) => (
        <tr key={e.id} className={e.voided_at ? 'text-slate-500' : ''}>
          <Row>{i + 1}</Row>
          <Row className="whitespace-nowrap">{fmtDateTime(e.occurred_at)}</Row>
          <Row className="whitespace-nowrap">{t(`wh.kind.${e.kind}` as MessageKey)}{e.doc_no ? ` ${e.doc_no}` : ''}{e.voided_at && <div className="text-xs">{t('wh.voided')}: {e.void_reason}</div>}</Row>
          <Row className="whitespace-nowrap">{e.batch_no ?? '—'}</Row>
          <Row className="text-right tabular-nums">{e.type === 'in' ? qty(e.quantity) : ''}</Row>
          <Row className="text-right tabular-nums">{e.type === 'out' ? qty(e.quantity) : ''}</Row>
          <Row className="text-right font-semibold tabular-nums">{qty(e.balance)}</Row>
          <Row className="min-w-[8rem]">{e.last_name ? `${e.last_name} ${e.first_name} #${e.patient_number}` : e.department ?? ''}{e.icd_codes?.length ? ` · ${e.icd_codes.join(', ')}` : ''}</Row>
          <Row className="min-w-[9rem]">{e.actor_name}{e.second_signer_name ? ` / ${e.second_signer_name}` : ''}{e.receiver_name ? <div className="text-xs">{t('wh.ctl.received', { name: e.receiver_name })}</div> : null}</Row>
        </tr>
      ))}</tbody>
    </>
  );
  return print ? <table className="w-full border-collapse text-2xs">{body}</table> : <Table>{body}</Table>;
}

// ------------------------------------------------------------------ expiring lots
export function ExpiringTab({ onWriteoff }: { onWriteoff: (batch: any) => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const [days, setDays] = useState<'30' | '90'>('90');
  const q = useQuery({ queryKey: ['warehouse', 'batches', branchId, 'expiring', days], queryFn: () => api(`/warehouse/batches${qs({ branch_id: branchId || undefined, expiring: days })}`).then((r) => r.data as any[]) });
  return (
    <>
      <div className="px-3 pt-1"><Tabs value={days} onChange={setDays} items={[{ value: '30', label: t('wh.exp.days', { n: 30 }) }, { value: '90', label: t('wh.exp.days', { n: 90 }) }]} /></div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.length ? <EmptyState compact title={t('wh.exp.none')} /> : (
        <Table>
          <thead><tr><Th>{t('wh.col.item')}</Th><Th>{t('wh.col.batch')}</Th><Th>{t('wh.col.expiry')}</Th><Th right>{t('wh.col.qty')}</Th><Th right className="hidden sm:table-cell">{t('wh.col.sum')}</Th><Th><span className="sr-only">{t('wh.wo.create')}</span></Th></tr></thead>
          <tbody>{q.data!.map((b) => (
            <tr key={b.id} className={b.expired ? 'bg-red-50/60' : ''}>
              <Td className="min-w-[9rem]">{b.name}{b.controlled && <> <ControlledBadge /></>}{!branchId && <div className="text-small text-slate-600">{b.branch_name}</div>}</Td>
              <Td>{b.batch_no ?? '—'}</Td>
              <Td className="whitespace-nowrap"><Expiry date={b.expiry_date} today={me.today} /></Td>
              <Td right>{qty(b.qty)} {b.unit}</Td>
              <Td right className="hidden sm:table-cell">{formatSom(b.value)}</Td>
              <Td className="w-px">{b.expired && <Button size="sm" variant="ghost" onClick={() => onWriteoff(b)}>{t('wh.wo.create')}</Button>}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </>
  );
}

// ------------------------------------------------------------------ cold chain: devices and their log
type Device = { id: string; branch_id: string; branch_name: string; name: string; kind: 'fridge' | 'freezer' | 'room'; min_temp: number; max_temp: number; active: boolean;
  last_temperature: number | null; last_at: string | null; last_out: boolean | null };
const deg = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1).replace('.0', '')}`;
export function useDevices() {
  const { branchId } = useSession();
  return useQuery({ queryKey: ['warehouse', 'devices', branchId], queryFn: () => api(`/warehouse/fridge/devices${qs({ branch_id: branchId || undefined })}`).then((r) => r.data as Device[]) });
}
export function FridgeTab() {
  const t = useT();
  const { branchId } = useSession();
  const p = usePeriod(7);
  const devices = useDevices();
  const [device, setDevice] = useState('');
  const [editing, setEditing] = useState<Device | 'new' | null>(null);
  const q = useQuery({ queryKey: ['warehouse', 'fridge', branchId, device, p.from, p.to], queryFn: () => api(`/warehouse/fridge${qs({ branch_id: branchId || undefined, device_id: device || undefined, from: p.from, to: p.to })}`).then((r) => r.data as any[]) });
  return (
    <>
      <h3 className="px-5 pb-1 pt-2 text-body font-bold text-slate-900">{t('wh.fr.devices')}</h3>
      {devices.isLoading ? <LoadingRows rows={2} /> : !devices.data?.length ? <EmptyState compact icon={<Thermometer />} title={t('wh.fr.noDevices')} /> : (
        <ul className="grid grid-cols-1 gap-2 px-5 pb-3 sm:grid-cols-2 xl:grid-cols-3">
          {devices.data.map((d) => (
            <li key={d.id} className="flex items-start gap-3 rounded-field border border-slate-200 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{d.name}{!d.active && <span className="text-small font-normal text-slate-600"> · {t('wh.fr.inactive')}</span>}</span>
                <span className="block text-small text-slate-600">{t(`wh.fr.kind.${d.kind}` as MessageKey)} · {t('wh.fr.rangeOf', { min: deg(d.min_temp), max: deg(d.max_temp) })}{!branchId ? ` · ${d.branch_name}` : ''}</span>
                <span className={d.last_out ? 'block text-small font-semibold text-red-700' : 'block text-small text-slate-700'}>
                  {d.last_temperature == null ? t('wh.fr.never') : t('wh.fr.last', { temp: deg(d.last_temperature), time: fmtDateTime(d.last_at!) })}</span>
              </span>
              <Button size="icon-sm" variant="ghost" aria-label={t('wh.fr.editDevice', { name: d.name })} onClick={() => setEditing(d)}><Pencil className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <Toolbar actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('wh.fr.addDevice')}</Button>}>
        <DateRange from={p.from} to={p.to} onFrom={p.setFrom} onTo={p.setTo} />
        <Select aria-label={t('wh.fr.device')} className="sm:w-60" value={device} onChange={(e) => setDevice(e.target.value)}>
          <option value="">{t('wh.fr.allDevices')}</option>{(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Toolbar>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.length ? <EmptyState compact icon={<Thermometer />} title={t('wh.fr.none')} /> : (
        <Table>
          <thead><tr><Th>{t('wh.col.date')}</Th><Th>{t('wh.fr.device')}</Th><Th right>{t('wh.fr.temp')}</Th><Th className="hidden sm:table-cell">{t('wh.fr.by')}</Th></tr></thead>
          <tbody>{q.data!.map((r) => (
            <tr key={r.id} className={r.out_of_range ? 'bg-red-50/60' : ''}>
              <Td className="whitespace-nowrap">{fmtDateTime(r.recorded_at)}</Td>
              <Td className="min-w-[9rem]">{r.fridge}<div className="text-small text-slate-600">{t('wh.fr.rangeOf', { min: deg(r.min_allowed), max: deg(r.max_allowed) })}</div>{r.note && <div className="text-small text-slate-800">{r.note}</div>}</Td>
              <Td right>{r.out_of_range ? <Badge tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{deg(r.temperature)} °C</Badge> : `${deg(r.temperature)} °C`}</Td>
              <Td className="hidden sm:table-cell">{r.recorded_by_name}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {editing && <DeviceModal device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** A new cold-chain device (range from its kind, editable), or a rename / retire; the range is the manager's. */
function DeviceModal({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSession();
  const branch = useDocBranch();
  const [b, setB] = useState(device?.branch_id ?? branch);
  const [name, setName] = useState(device?.name ?? '');
  const [kind, setKind] = useState<Device['kind']>(device?.kind ?? 'fridge');
  const [min, setMin] = useState(String(device?.min_temp ?? COLD_DEVICE_RANGE.fridge[0]));
  const [max, setMax] = useState(String(device?.max_temp ?? COLD_DEVICE_RANGE.fridge[1]));
  const [active, setActive] = useState(device?.active ?? true);
  const [err, setErr] = useState<Record<string, string>>({});
  const canRange = !device || me.role === 'manager';
  const nMin = Number(min.replace(',', '.')), nMax = Number(max.replace(',', '.'));
  const rangeErr = Number.isNaN(nMin) || Number.isNaN(nMax) || min.trim() === '' || max.trim() === '' ? t('admin.inv.errNumber') : nMin >= nMax ? t('api.wh.rangeOrder') : undefined;
  const m = useMutation({
    mutationFn: () => device
      ? api(`/warehouse/fridge/devices/${device.id}`, { method: 'PATCH', body: { name: name.trim(), active, ...(canRange ? { min_temp: nMin, max_temp: nMax } : {}) } })
      : api('/warehouse/fridge/devices', { method: 'POST', body: { branch_id: b, name: name.trim(), kind, min_temp: nMin, max_temp: nMax } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouse'] }); toast.success(t('wh.fr.deviceSaved')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  return (
    <Modal open onClose={onClose} dirty={!device ? !!name : name !== device.name || active !== device.active} title={device ? t('wh.fr.editDevice', { name: device.name }) : t('wh.fr.addDevice')}
      footer={<><ModalCancel /><Button variant="primary" disabled={name.trim().length < 2 || !b || !!rangeErr} loading={m.isPending} onClick={() => m.mutate()}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!device && me.branches.length > 1 && <Field label={t('admin.inv.branch')} required>{(id) => <Select id={id} value={b} onChange={(e) => setB(e.target.value)}><option value="">—</option>{me.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>}
        <Field label={t('wh.fr.device')} required error={err.name}>{(id) => <Input id={id} data-autofocus value={name} maxLength={60} placeholder={t('wh.fr.fridgePh')} onChange={(e) => setName(e.target.value)} />}</Field>
        {!device && <Field label={t('wh.fr.kind')} required>{(id) => (
          <Select id={id} value={kind} onChange={(e) => { const k = e.target.value as Device['kind']; setKind(k); setMin(String(COLD_DEVICE_RANGE[k][0])); setMax(String(COLD_DEVICE_RANGE[k][1])); }}>
            {(['fridge', 'freezer', 'room'] as const).map((k) => <option key={k} value={k}>{t(`wh.fr.kind.${k}` as MessageKey)}</option>)}
          </Select>)}</Field>}
        <Field label={t('wh.fr.min')} required error={err.min_temp ?? rangeErr} hint={!canRange ? t('wh.fr.rangeManager') : undefined}>{(id) => <Input id={id} inputMode="decimal" disabled={!canRange} value={min} onChange={(e) => setMin(e.target.value)} />}</Field>
        <Field label={t('wh.fr.max')} required error={err.max_temp}>{(id) => <Input id={id} inputMode="decimal" disabled={!canRange} value={max} onChange={(e) => setMax(e.target.value)} />}</Field>
        {device && <Checkbox rowClassName="font-medium sm:col-span-2" checked={active} onChange={(e) => setActive(e.target.checked)} label={t('wh.fr.activeCheck')} />}
      </div>
    </Modal>
  );
}

export function FridgeModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const devices = useDevices();
  const list = (devices.data ?? []).filter((d) => d.active);
  const [pick, setPick] = useState('');
  const device = list.find((d) => d.id === (pick || (list.length === 1 ? list[0].id : '')));
  const [temp, setTemp] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const n = Number(temp.replace(',', '.').replace('−', '-'));
  const bad = temp.trim() === '' || Number.isNaN(n) || n < -40 || n > 40;
  const out = !bad && !!device && (n < device.min_temp || n > device.max_temp);
  const m = useMutation({
    mutationFn: () => api('/warehouse/fridge', { method: 'POST', body: { device_id: device!.id, temperature: n, note: note.trim() || null } }),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['warehouse'] }); (r.data.out_of_range ? toast.info : toast.success)(t(r.data.out_of_range ? 'wh.fr.savedOut' : 'wh.fr.saved')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  return (
    <Modal open onClose={onClose} dirty={!!temp} title={t('wh.fr.add')}
      footer={<><ModalCancel /><Button variant="primary" disabled={bad || !device || (out && note.trim().length < 3)} loading={m.isPending} onClick={() => m.mutate()}>{t('common.save')}</Button></>}>
      {!devices.isLoading && !list.length ? <EmptyState compact icon={<Thermometer />} title={t('wh.fr.noDevices')} /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('wh.fr.device')} required className="sm:col-span-2" error={err.device_id}>{(id) => (
            <Select id={id} data-autofocus value={device?.id ?? ''} onChange={(e) => setPick(e.target.value)}>
              <option value="">—</option>{list.map((d) => <option key={d.id} value={d.id}>{d.name}{d.branch_name ? ` · ${d.branch_name}` : ''}</option>)}
            </Select>)}</Field>
          <Field label={t('wh.fr.temp')} required hint={device ? t('wh.fr.rangeOf', { min: deg(device.min_temp), max: deg(device.max_temp) }) : undefined} error={out ? `${t('wh.fr.outOfRange')} · ${t('wh.fr.rangeOf', { min: deg(device!.min_temp), max: deg(device!.max_temp) })}` : err.temperature}>{(id) => <Input id={id} inputMode="decimal" value={temp} invalid={out} onChange={(e) => setTemp(e.target.value)} />}</Field>
          {(out || err.note) && <Field label={t('wh.fr.action')} required className="sm:col-span-2" hint={t('wh.fr.actionRequired')} error={err.note}>{(id) => <Input id={id} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />}</Field>}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ reports
const GROUPS = ['doctor', 'patient', 'icd', 'service', 'department', 'item'] as const;
/** By patient, diagnosis, doctor or procedure — the manager only; the storekeeper sees items and departments. */
const KEEPER_GROUPS = ['item', 'department'] as const;
export function ReportsTab() {
  const t = useT();
  const { locale } = useI18n();
  const { me, branchId } = useSession();
  const p = usePeriod();
  const groups = me.role === 'manager' ? GROUPS : KEEPER_GROUPS;
  const [group, setGroup] = useState<(typeof GROUPS)[number]>(groups[0]);
  const f = { group, from: p.from, to: p.to, branch_id: branchId || undefined };
  const q = useQuery({ queryKey: ['warehouse', 'report', group, p.from, p.to, branchId], queryFn: () => api(`/warehouse/reports/consumption${qs(f)}`).then((r) => r.data) });
  const manager = me.role === 'manager';
  return (
    <>
      <Toolbar actions={<CsvLink href={`/api/v1/warehouse/reports/consumption.csv${qs(f)}`} />}>
        <DateRange from={p.from} to={p.to} onFrom={p.setFrom} onTo={p.setTo} />
        <Select aria-label={t('wh.rep.group')} className="sm:w-56" value={group} onChange={(e) => setGroup(e.target.value as (typeof GROUPS)[number])}>
          {groups.map((g) => <option key={g} value={g}>{t(`wh.rep.by.${g}` as MessageKey)}</option>)}
        </Select>
      </Toolbar>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.rows.length ? <EmptyState compact title={t('wh.mv.none')} /> : (
        <Table>
          <thead><tr><Th>{t(`wh.rep.by.${group}` as MessageKey)}</Th>{group === 'item' && <Th right>{t('wh.rep.qty')}</Th>}<Th right className="hidden sm:table-cell">{t('wh.rep.requests')}</Th>{manager && <Th right className="hidden sm:table-cell">{t('wh.rep.patients')}</Th>}<Th right>{t('wh.col.sum')}</Th></tr></thead>
          <tbody>
            {q.data.rows.map((r: any) => (
              <tr key={r.key ?? 'none'}>
                <Td className="min-w-[10rem]">{r.label ?? <span className="text-slate-600">{t('wh.rep.noValue')}</span>}{group === 'icd' && (locale === 'ru' ? r.title_ru : r.title_uz) && <div className="text-small text-slate-600">{locale === 'ru' ? r.title_ru : r.title_uz}</div>}
                  {group !== 'item' && r.items?.length > 0 && <div className="text-small text-slate-700">{r.items.map((it: any) => `${it.name} × ${qty(it.qty)} ${it.unit}`).join('; ')}{r.items_total > r.items.length ? `; ${t('wh.rep.more', { n: r.items_total - r.items.length })}` : ''}</div>}</Td>
                {group === 'item' && <Td right>{qty(r.qty)} <span className="text-small text-slate-600">{r.unit}</span></Td>}
                <Td right className="hidden sm:table-cell">{r.requests}</Td>
                {manager && <Td right className="hidden sm:table-cell">{r.patients}</Td>}
                <Td right>{formatSom(r.value)}</Td>
              </tr>
            ))}
            <tr className="font-bold"><Td>{t('wh.rep.total')}</Td>{group === 'item' && <Td />}<Td className="hidden sm:table-cell" />{manager && <Td className="hidden sm:table-cell" />}<Td right>{formatSom(q.data.total)}</Td></tr>
          </tbody>
        </Table>
      )}
    </>
  );
}
