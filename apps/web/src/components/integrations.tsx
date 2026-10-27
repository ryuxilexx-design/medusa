'use client';
// Sozlamalar → Integratsiyalar → MedPlus (docs/MEDPLUS_SYNC.md): connect (the bridge key is shown once), status,
// mappings the manager confirms, possible duplicates, waiting records, the sync log, the daily reconciliation and the
// file import. Manager only (the server checks every call). No personal data is kept in the browser.
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, FileSpreadsheet, KeyRound, Link2, Pause, Play, PlugZap } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { addDays, fmtDate, fmtDateTime, formatSom, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { DateRange } from './date-range';
import { Alert, Badge, Button, Card, Checkbox, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Money, Pagination, Segmented, Select, StatCard, Table, Tabs, Td, TextLink, Th, Toolbar, useToast } from './ui';

/** The product name goes into messages as a placeholder, so it is never transliterated. */
export const MP = { mp: 'MedPlus' };

/** «MedPlus #28354»: a card, a visit or an invoice mirrored from MedPlus (edited there, read-only here). */
export function MirrorBadge({ id }: { id?: string | null }) {
  const t = useT();
  return <span title={t('sync.badgeTitle', MP)}><Badge tone="violet" icon={<Link2 className="h-3.5 w-3.5" />}>{id ? t('sync.badgeId', { ...MP, id }) : t('sync.badge', MP)}</Badge></span>;
}

type Source = { id: string; name: string; active: boolean; last_seen_at: string | null; last_batch_at: string | null; has_token: boolean; created_at: string };
type Status = {
  counts: { patients: number; visits: number; orders: number; payments: number; payments_sum: number; refunds: number };
  pending: { reason: string; n: number }[]; pending_total: number; review: Record<string, number>; duplicates: number; errors_24h: number;
  last: { finished_at: string } | null;
};
type Tab = 'mapping' | 'duplicates' | 'pending' | 'import' | 'reconcile' | 'log';

export function IntegrationsSettings() {
  const t = useT();
  const q = useQuery({ queryKey: ['sync', 'sources'], queryFn: () => api<{ data: Source[] }>('/integrations/sources').then((r) => r.data) });
  const [connecting, setConnecting] = useState(false);
  const [token, setToken] = useState<{ id: string; token: string } | null>(null);
  if (q.isLoading) return <Card><LoadingRows rows={4} /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const src = q.data![0];
  return (
    <>
      {src ? <SourceView src={src} onToken={setToken} /> : (
        <Card>
          <EmptyState icon={<PlugZap />} title={t('sync.emptyTitle', MP)} text={t('sync.emptyText', MP)}
            action={<Button variant="primary" icon={<PlugZap className="h-4 w-4" />} onClick={() => setConnecting(true)}>{t('sync.connect', MP)}</Button>} />
        </Card>
      )}
      {connecting && <ConnectModal onClose={() => setConnecting(false)} onCreated={(id, tok) => { setConnecting(false); setToken({ id, token: tok }); }} />}
      {token && <TokenModal sourceId={token.id} token={token.token} onClose={() => setToken(null)} />}
    </>
  );
}

function ConnectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, token: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('MedPlus');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api<{ data: Source & { token: string } }>('/integrations/sources', { method: 'POST', body: { name: name.trim() } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['sync'] }); onCreated(r.data.id, r.data.token); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); else toast.error(e); },
  });
  return (
    <Modal open onClose={onClose} title={t('sync.connect', MP)} footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate()}>{t('sync.create')}</Button></>}>
      <Field label={t('sync.name')} error={errors.name}>{(id) => <Input id={id} data-autofocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} />}</Field>
    </Modal>
  );
}

/** The bridge key, once: the manager copies it into the bridge's config.json on the clinic PC. */
function TokenModal({ sourceId, token, onClose }: { sourceId: string; token: string; onClose: () => void }) {
  const t = useT();
  const server = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <Modal open onClose={onClose} title={t('sync.tokenTitle')} footer={<Button variant="primary" onClick={onClose}>{t('sync.tokenDone')}</Button>}>
      <div className="flex flex-col gap-4">
        <Alert tone="yellow">{t('sync.tokenOnce')}</Alert>
        <CopyField label={t('sync.endpoint')} value={server} />
        <CopyField label={t('sync.sourceId')} value={sourceId} />
        <CopyField label={t('sync.token')} value={token} testId="sync-token" />
      </div>
    </Modal>
  );
}

function CopyField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const t = useT();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast.success(t('sync.copied')); } catch { ref.current?.select(); }
  };
  return (
    <Field label={label}>
      {(id) => (
        <div className="flex gap-2">
          <Input id={id} ref={ref} readOnly value={value} data-testid={testId} className="min-w-0 flex-1 font-mono" onFocus={(e) => e.currentTarget.select()} />
          <Button size="icon" aria-label={`${t('sync.copy')}: ${label}`} title={t('sync.copy')} onClick={copy}><Copy className="h-4 w-4" /></Button>
        </div>
      )}
    </Field>
  );
}

function SourceView({ src, onToken }: { src: Source; onToken: (x: { id: string; token: string }) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('mapping');
  const [rotating, setRotating] = useState(false);
  const st = useQuery({ queryKey: ['sync', 'status', src.id], queryFn: () => api<{ data: Status }>(`/integrations/sources/${src.id}/status`).then((r) => r.data), refetchInterval: 60_000 });
  const rotate = useMutation({
    mutationFn: () => api<{ data: { id: string; token: string } }>(`/integrations/sources/${src.id}/token`, { method: 'POST' }),
    onSuccess: (r) => { setRotating(false); qc.invalidateQueries({ queryKey: ['sync', 'sources'] }); onToken(r.data); },
    onError: (e) => toast.error(e),
  });
  const toggle = useMutation({
    mutationFn: () => api(`/integrations/sources/${src.id}`, { method: 'PATCH', body: { active: !src.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync'] }),
    onError: (e) => toast.error(e),
  });
  const s = st.data;
  const review = s ? Object.values(s.review).reduce((a, n) => a + n, 0) : undefined;
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'mapping', label: t('sync.tab.mapping'), count: review || undefined },
    { value: 'duplicates', label: t('sync.tab.duplicates'), count: s?.duplicates || undefined },
    { value: 'pending', label: t('sync.tab.pending'), count: s?.pending_total || undefined },
    { value: 'import', label: t('sync.tab.import') },
    { value: 'reconcile', label: t('sync.tab.reconcile') },
    { value: 'log', label: t('sync.tab.log') },
  ];
  return (
    <div className="flex flex-col gap-5">
      <Card title={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">{src.name}{src.active ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('sync.active')}</Badge> : <Badge>{t('sync.paused')}</Badge>}</span>}
        actions={<>
          <Button size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={() => setRotating(true)}>{t('sync.newToken')}</Button>
          <Button size="sm" icon={src.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} loading={toggle.isPending} onClick={() => toggle.mutate()}>{src.active ? t('sync.pause') : t('sync.resume')}</Button>
        </>}>
        <p className="text-body text-slate-700">{src.last_batch_at ? t('sync.lastBatch', { time: fmtDateTime(src.last_batch_at) }) : t('sync.never')}</p>
      </Card>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard label={t('sync.stat.patients')} value={s?.counts.patients} loading={!s} />
        <StatCard label={t('sync.stat.visits')} value={s?.counts.visits} loading={!s} />
        <StatCard label={t('sync.stat.payments')} value={s ? <Money tiyin={s.counts.payments_sum} /> : undefined} sub={s ? t('sync.rec.count', { n: s.counts.payments }) : undefined} loading={!s} />
        <StatCard label={t('sync.stat.pending')} value={s?.pending_total} sub={s && s.errors_24h > 0 ? `${t('sync.stat.errors')}: ${s.errors_24h}` : undefined} tone={s && (s.errors_24h > 0) ? 'danger' : 'default'} loading={!s} />
      </div>
      <Card padded={false}>
        <div className="px-3 pt-3"><Tabs value={tab} onChange={setTab} items={tabs} label={t('sync.title', MP)} /></div>
        <div className="mt-3 border-t border-slate-100">
          {tab === 'mapping' && <Mappings src={src} />}
          {tab === 'duplicates' && <Duplicates src={src} />}
          {tab === 'pending' && <Pending src={src} />}
          {tab === 'import' && <FileImport src={src} />}
          {tab === 'reconcile' && <Reconcile src={src} />}
          {tab === 'log' && <Log src={src} />}
        </div>
      </Card>
      <Modal open={rotating} onClose={() => setRotating(false)} title={t('sync.newToken')}
        footer={<><ModalCancel /><Button variant="primary" loading={rotate.isPending} onClick={() => rotate.mutate()}>{t('sync.newToken')}</Button></>}>
        <Alert tone="yellow">{t('sync.newTokenConfirm')}</Alert>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- mappings

type MapKind = 'branch' | 'service' | 'doctor' | 'method' | 'staff';
type MappingRow = { id: string; kind: MapKind; external_id: string; external_name: string | null; target_id: string | null; target_code: string | null; target_name: string | null; placeholder: boolean; status: 'auto' | 'confirmed' };

function Mappings({ src }: { src: Source }) {
  const t = useT();
  const [kind, setKind] = useState<MapKind>('branch');
  const [onlyReview, setOnlyReview] = useState(false);
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['sync', 'mappings', src.id, kind, onlyReview, page], queryFn: () => api<{ data: MappingRow[]; meta: any }>(`/integrations/sources/${src.id}/mappings${qs({ kind, review: onlyReview ? 1 : undefined, page, page_size: 20 })}`), placeholderData: (p) => p });
  const targets = useQuery({ enabled: kind !== 'method', queryKey: ['sync', 'targets', src.id, kind], queryFn: () => api<{ data: { id: string; name: string }[] }>(`/integrations/sources/${src.id}/targets?kind=${kind}`).then((r) => r.data) });
  return (
    <>
      <Toolbar>
        <Select aria-label={t('sync.col.kind')} className="w-full sm:w-64" value={kind} onChange={(e) => { setKind(e.target.value as MapKind); setPage(1); }}>
          {(['branch', 'service', 'doctor', 'method', 'staff'] as MapKind[]).map((k) => <option key={k} value={k}>{t(`sync.kind.${k}` as MessageKey)}</option>)}
        </Select>
        <Checkbox label={t('sync.onlyReview')} checked={onlyReview} onChange={(e) => { setOnlyReview(e.target.checked); setPage(1); }} />
      </Toolbar>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.data.length ? <EmptyState compact title={t('sync.mapEmpty')} /> : (
        <>
          <Table>
            <thead><tr><Th>{t('sync.col.external', MP)}</Th><Th>{t('sync.col.ours')}</Th><Th className="hidden md:table-cell">{t('sync.col.state')}</Th><Th /></tr></thead>
            <tbody>{q.data!.data.map((m) => <MappingLine key={m.id} m={m} src={src} targets={targets.data ?? []} />)}</tbody>
          </Table>
          <Pagination page={page} pageSize={20} total={q.data!.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

function StateBadge({ m }: { m: MappingRow }) {
  const t = useT();
  const unmapped = m.kind === 'method' ? !m.target_code : m.kind !== 'staff' && !m.target_id;
  if (unmapped) return <Badge tone="red">{t('sync.state.unmapped')}</Badge>;
  if (m.status === 'confirmed') return <Badge tone="green">{t('sync.state.confirmed')}</Badge>;
  return <Badge tone="yellow">{m.placeholder ? t('sync.state.placeholder') : t('sync.state.auto')}</Badge>;
}

function MappingLine({ m, src, targets }: { m: MappingRow; src: Source; targets: { id: string; name: string }[] }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const current = m.kind === 'method' ? m.target_code ?? '' : m.target_id ?? '';
  const [value, setValue] = useState(current);
  const save = useMutation({
    mutationFn: () => api<{ data: { applied_pending: number } }>(`/integrations/sources/${src.id}/mappings/${m.id}`, { method: 'PATCH', body: m.kind === 'method' ? { target_code: value } : { target_id: value || null } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['sync'] }); toast.success(r.data.applied_pending ? t('sync.appliedPending', { n: r.data.applied_pending }) : t('sync.mapSaved')); },
    onError: (e) => toast.error(e),
  });
  // a placeholder service/doctor is not in the targets list: show it as the current choice
  const options = m.target_id && m.target_name && !targets.some((x) => x.id === m.target_id) ? [{ id: m.target_id, name: m.target_name }, ...targets] : targets;
  const canSave = (m.kind === 'staff' || value !== '') && (value !== current || m.status !== 'confirmed');
  return (
    <tr>
      <Td className="min-w-[10rem]"><div className="font-medium text-slate-900">{m.external_name ?? m.external_id}</div>{!m.external_id.startsWith('name:') && <div className="text-small tabular-nums text-slate-600">ID {m.external_id}</div>}<div className="mt-1 md:hidden"><StateBadge m={m} /></div></Td>
      <Td className="min-w-[12rem]">
        <Select size="sm" aria-label={`${t('sync.col.ours')}: ${m.external_name ?? m.external_id}`} value={value} onChange={(e) => setValue(e.target.value)} className="w-full">
          {m.kind === 'staff' ? <option value="">{t('sync.noStaff')}</option> : <option value="" disabled>{t('sync.choose')}</option>}
          {m.kind === 'method'
            ? (['cash', 'card', 'transfer'] as const).map((c) => <option key={c} value={c}>{t(`payment.${c}` as MessageKey)}</option>)
            : options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </Td>
      <Td className="hidden md:table-cell"><StateBadge m={m} /></Td>
      <Td right><Button size="sm" disabled={!canSave} loading={save.isPending} onClick={() => save.mutate()}>{t('sync.confirm')}</Button></Td>
    </tr>
  );
}

// ---------------------------------------------------------------- duplicates / pending / log

function Duplicates({ src }: { src: Source }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['sync', 'duplicates', src.id, page], queryFn: () => api<{ data: any[]; meta: any }>(`/integrations/sources/${src.id}/duplicates?page=${page}&page_size=20`), placeholderData: (p) => p });
  const review = useMutation({
    mutationFn: (id: string) => api(`/integrations/sources/${src.id}/duplicates/${id}/review`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sync'] }); toast.success(t('sync.dup.done')); },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.data.length) return <EmptyState compact title={t('sync.dup.empty')} />;
  const person = (p: any) => <><TextLink href={`/patients/${p.id ?? p.patient_id}`}>{fullName(p)}</TextLink> <span className="tabular-nums text-slate-600">{pid(p.patient_number)} · {fmtDate(p.birth_date)}</span></>;
  return (
    <>
      <Table>
        <thead><tr><Th>{t('sync.col.newCard')}</Th><Th>{t('sync.col.candidates')}</Th><Th className="hidden lg:table-cell">{t('sync.col.reason')}</Th><Th /></tr></thead>
        <tbody>{q.data!.data.map((d) => (
          <tr key={d.id} className="align-top">
            <Td className="min-w-[12rem]">{person(d)}<div className="mt-1 text-small text-slate-600 lg:hidden">{t(`sync.dup.${d.reason}` as MessageKey, MP)}</div></Td>
            <Td className="min-w-[12rem]"><ul className="space-y-1">{(d.candidates ?? []).map((c: any) => <li key={c.id}>{person(c)}</li>)}</ul></Td>
            <Td className="hidden text-slate-700 lg:table-cell">{t(`sync.dup.${d.reason}` as MessageKey, MP)}</Td>
            <Td right><Button size="sm" loading={review.isPending && review.variables === d.id} onClick={() => review.mutate(d.id)}>{t('sync.dup.review')}</Button></Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data!.meta.total} onPage={setPage} />
    </>
  );
}

function Pending({ src }: { src: Source }) {
  const t = useT();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['sync', 'pending', src.id, page], queryFn: () => api<{ data: any[]; meta: any }>(`/integrations/sources/${src.id}/pending?page=${page}&page_size=20`), placeholderData: (p) => p });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.data.length) return <EmptyState compact title={t('sync.pending.empty')} />;
  return (
    <>
      <Table>
        <thead><tr><Th>{t('sync.col.kind')}</Th><Th>{t('sync.col.extId', MP)}</Th><Th>{t('sync.col.reason')}</Th><Th className="hidden sm:table-cell">{t('sync.col.since')}</Th><Th right className="hidden sm:table-cell">{t('sync.col.attempts')}</Th></tr></thead>
        <tbody>{q.data!.data.map((r) => (
          <tr key={r.id}>
            <Td>{t(`sync.rec.${r.kind}` as MessageKey)}</Td>
            <Td className="tabular-nums">{r.external_id}</Td>
            <Td className="min-w-[10rem] text-slate-700">{t(`sync.reason.${r.reason}` as MessageKey)}<div className="text-small tabular-nums text-slate-600 sm:hidden">{fmtDateTime(r.first_seen_at)}</div></Td>
            <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{fmtDateTime(r.first_seen_at)}</Td>
            <Td right className="hidden sm:table-cell">{r.attempts}</Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data!.meta.total} onPage={setPage} />
    </>
  );
}

/** An error code from the server in the person's language (unknown codes stay as they are). */
function useErrText() {
  const t = useT();
  return (code: string, field?: string) => {
    const k = `sync.err.${code}` as MessageKey;
    const s = t(k, { field: field ? t(`sync.field.${field}` as MessageKey, MP) : '', ...MP });
    if (s !== k) return s;
    const r = `sync.reason.${code}` as MessageKey;
    const s2 = t(r);
    return s2 !== r ? s2 : code;
  };
}

function Log({ src }: { src: Source }) {
  const t = useT();
  const err = useErrText();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['sync', 'log', src.id, page], queryFn: () => api<{ data: any[]; meta: any }>(`/integrations/sources/${src.id}/log?page=${page}&page_size=20`), placeholderData: (p) => p });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.data.length) return <EmptyState compact title={t('sync.log.empty')} />;
  return (
    <>
      <Table>
        <thead><tr><Th>{t('sync.col.time')}</Th><Th className="hidden sm:table-cell">{t('sync.col.channel')}</Th><Th right>{t('sync.col.received')}</Th><Th right>{t('sync.col.created')}</Th><Th right className="hidden md:table-cell">{t('sync.col.updated')}</Th><Th right className="hidden md:table-cell">{t('sync.col.parked')}</Th><Th right>{t('sync.col.errors')}</Th></tr></thead>
        <tbody>{q.data!.data.map((r) => (
          <tr key={r.id} className="align-top">
            <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.finished_at)}<div className="text-small text-slate-600 sm:hidden">{t(`sync.channel.${r.channel}` as MessageKey)}</div>
              {r.error_samples?.length > 0 && <div className="mt-1 max-w-[22rem] whitespace-normal text-small text-red-700">{[...new Set(r.error_samples.map((x: any) => err(x.code)))].join(', ')}</div>}</Td>
            <Td className="hidden sm:table-cell">{t(`sync.channel.${r.channel}` as MessageKey)}{r.actor_name ? <div className="text-small text-slate-600">{r.actor_name}</div> : null}</Td>
            <Td right>{r.received}</Td><Td right>{r.created}</Td><Td right className="hidden md:table-cell">{r.updated}</Td><Td right className="hidden md:table-cell">{r.parked}</Td>
            <Td right className={r.errors ? 'font-semibold text-red-700' : ''}>{r.errors}</Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data!.meta.total} onPage={setPage} />
    </>
  );
}

// ---------------------------------------------------------------- reconciliation

function Reconcile({ src }: { src: Source }) {
  const t = useT();
  const { me } = useSession();
  const [from, setFrom] = useState(addDays(me.today, -6));
  const [to, setTo] = useState(me.today);
  const q = useQuery({ queryKey: ['sync', 'reconcile', src.id, from, to], queryFn: () => api<{ data: any }>(`/integrations/sources/${src.id}/reconciliation${qs({ from, to })}`).then((r) => r.data), placeholderData: (p) => p });
  return (
    <>
      <Toolbar><DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} /></Toolbar>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          {q.data.patients.reported != null && <p className="border-b border-slate-100 px-5 py-3 text-body text-slate-700">{t('sync.rec.patients', { ...MP, reported: q.data.patients.reported, ours: q.data.patients.ours })}</p>}
          {!q.data.rows.length ? <EmptyState compact title={t('sync.rec.empty')} /> : (
            <Table>
              <thead><tr><Th>{t('sync.col.day')}</Th><Th className="hidden sm:table-cell">{t('sync.col.branch')}</Th><Th right>{t('sync.col.reported', MP)}</Th><Th right>{t('sync.col.ours')}</Th><Th right>{t('sync.col.diff')}</Th></tr></thead>
              <tbody>{q.data.rows.map((r: any) => (
                <tr key={`${r.day}|${r.branch_id}`}>
                  <Td className="whitespace-nowrap tabular-nums">{fmtDate(r.day)}<div className="text-small text-slate-600 sm:hidden">{r.branch_name ?? t('sync.rec.allBranches')}</div></Td>
                  <Td className="hidden sm:table-cell">{r.branch_name ?? t('sync.rec.allBranches')}</Td>
                  <Td right>{r.reported_sum == null ? '—' : formatSom(r.reported_sum)}{r.reported_count != null && <div className="text-small text-slate-600">{t('sync.rec.count', { n: r.reported_count })}</div>}</Td>
                  <Td right>{formatSom(r.our_sum)}<div className="text-small text-slate-600">{t('sync.rec.count', { n: r.our_count })}</div></Td>
                  <Td right>{r.diff_sum == null ? <Badge>{t('sync.rec.noReport')}</Badge> : r.diff_sum === 0 && r.diff_count === 0 ? <Badge tone="green">{t('sync.rec.ok')}</Badge>
                    : <span className="inline-flex flex-col items-end gap-1"><Badge tone="red">{t('sync.rec.mismatch')}</Badge><span className="tabular-nums text-red-700">{formatSom(r.diff_sum)}</span></span>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- file import

type ImportKind = 'patients' | 'payments' | 'services';
type Preview = { kind: ImportKind; header_row: number; headers: string[]; guess: Record<string, number>; sample: unknown[][]; rows: number; fields: { key: string; required: boolean }[] };
type ImportResult = { dry_run: boolean; total_rows: number; checked_rows: number; created: number; updated: number; unchanged: number; parked: number; skipped: number; errors: number; file_errors: number; row_errors: { row: number; code: string; field?: string; outcome?: string }[] };

function FileImport({ src }: { src: Source }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const err = useErrText();
  const [kind, setKind] = useState<ImportKind>('patients');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reset = () => { setPreview(null); setResult(null); setMapping({}); };
  const form = (extra: Record<string, string>) => { const f = new FormData(); f.append('file', file!); f.append('kind', kind); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };
  const read = useMutation({
    mutationFn: () => api<{ data: Preview }>(`/integrations/sources/${src.id}/import/preview`, { method: 'POST', body: form({}) }),
    onSuccess: (r) => { setPreview(r.data); setMapping(r.data.guess); setResult(null); },
    onError: (e) => toast.error(e),
  });
  const run = useMutation({
    mutationFn: (dry: boolean) => api<{ data: ImportResult }>(`/integrations/sources/${src.id}/import`, { method: 'POST', body: form({ mapping: JSON.stringify(mapping), dry_run: dry ? '1' : '0' }) }),
    onSuccess: (r) => {
      setResult(r.data);
      if (!r.data.dry_run) { qc.invalidateQueries({ queryKey: ['sync'] }); toast.success(t('sync.imp.done', { created: r.data.created, updated: r.data.updated })); }
    },
    onError: (e) => toast.error(e),
  });
  const missing = preview ? preview.fields.filter((f) => f.required && (mapping[f.key] === undefined || mapping[f.key] < 0)) : [];
  const used = useMemo(() => (preview ? preview.fields.filter((f) => mapping[f.key] !== undefined && mapping[f.key] >= 0) : []), [preview, mapping]);
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-800">{t('sync.imp.kind')}</span>
          <Segmented label={t('sync.imp.kind')} value={kind} stretch className="w-full sm:w-auto" onChange={(v) => { setKind(v); reset(); }}
            options={(['patients', 'services', 'payments'] as ImportKind[]).map((k) => ({ value: k, label: t(`sync.imp.${k}` as MessageKey) }))} />
        </div>
        <Field label={t('sync.imp.file', { formats: 'XLSX, CSV · 10 MB' })} className="min-w-0 lg:flex-1">
          {(id) => <input id={id} ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.txt" data-testid="sync-file"
            className="block min-h-control w-full rounded-field border border-slate-300 bg-white px-3 py-2 text-body text-slate-800 file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-slate-800"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />}
        </Field>
        <Button icon={<FileSpreadsheet className="h-4 w-4" />} disabled={!file} loading={read.isPending} onClick={() => read.mutate()}>{t('sync.imp.read')}</Button>
      </div>
      <p className="text-small text-slate-600">{t('sync.imp.order')}</p>

      {preview && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h3 className="text-base font-bold text-slate-900">{t('sync.imp.columns')}</h3>
            <span className="text-small text-slate-600">{t('sync.imp.headerRow', { n: preview.header_row })} · {t('sync.imp.rows', { n: preview.rows })}</span>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {preview.fields.map((f) => (
              <Field key={f.key} label={t(`sync.field.${f.key}` as MessageKey, MP)} required={f.required}>
                {(id) => (
                  <Select id={id} size="sm" value={mapping[f.key] ?? -1} invalid={f.required && (mapping[f.key] ?? -1) < 0}
                    onChange={(e) => { setMapping({ ...mapping, [f.key]: Number(e.target.value) }); setResult(null); }}>
                    <option value={-1}>{t('sync.imp.notUsed')}</option>
                    {preview.headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                  </Select>
                )}
              </Field>
            ))}
          </div>
          {used.length > 0 && preview.sample.length > 0 && (
            <div className="overflow-hidden rounded-field border border-slate-200">
              <Table>
                <thead><tr>{used.map((f) => <Th key={f.key}>{t(`sync.field.${f.key}` as MessageKey, MP)}</Th>)}</tr></thead>
                <tbody>{preview.sample.slice(0, 3).map((row, i) => <tr key={i}>{used.map((f) => <Td key={f.key} className="whitespace-nowrap text-slate-700">{String(row[mapping[f.key]] ?? '')}</Td>)}</tr>)}</tbody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={missing.length > 0} loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>{t('sync.imp.check')}</Button>
            <Button variant="primary" disabled={missing.length > 0 || run.isPending} loading={run.isPending && run.variables === false} onClick={() => run.mutate(false)}>{t('sync.imp.run')}</Button>
          </div>
        </section>
      )}

      {result && (
        <section className="flex flex-col gap-3" aria-live="polite" data-testid="sync-import-result">
          <p className="text-body font-semibold text-slate-900">{result.dry_run ? t('sync.imp.checked', { n: result.checked_rows }) : t('sync.imp.done', { created: result.created, updated: result.updated })}</p>
          <div className="flex flex-wrap gap-2">
            <Badge tone="green">{t('sync.res.created', { n: result.created })}</Badge>
            <Badge tone="blue">{t('sync.res.updated', { n: result.updated })}</Badge>
            <Badge>{t('sync.res.unchanged', { n: result.unchanged })}</Badge>
            {result.parked > 0 && <Badge tone="yellow">{t('sync.res.parked', { n: result.parked })}</Badge>}
            {(result.errors + result.file_errors) > 0 && <Badge tone="red">{t('sync.res.errors', { n: result.errors + result.file_errors })}</Badge>}
          </div>
          {result.row_errors.length > 0 && (
            <div className="overflow-hidden rounded-field border border-slate-200">
              <Table>
                <thead><tr><Th>{t('sync.col.row')}</Th><Th>{t('sync.col.problem')}</Th></tr></thead>
                <tbody>{result.row_errors.map((e, i) => (
                  <tr key={i}><Td className="tabular-nums">{e.row || '—'}</Td><Td className={cx(e.outcome === 'parked' ? 'text-amber-800' : 'text-red-700')}>{err(e.code, e.field)}</Td></tr>
                ))}</tbody>
              </Table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
