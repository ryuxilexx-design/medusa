'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet, MinusCircle, Pencil, Plus, Search } from 'lucide-react';
import { SERVICE_CATEGORIES, VAT_OPTIONS, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { formatPhone, formatSom, parseSomToTiyin } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { MoneyInput } from '@/components/money-input';
import { DaysOff } from '@/components/days-off';
import { PriceImportModal } from '@/components/price-import';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, KeyVal, LoadingRows, Modal, ModalCancel, Select, Table, Td, Th, Toolbar, useToast } from '@/components/ui';

/**
 * The clinic's catalogue, managed by the manager without a developer: services with prices, rooms and branches.
 * Nothing is deleted — a row is switched off and keeps the old appointments, orders and reports intact.
 */

const ActiveCheck = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <Checkbox rowClassName="font-medium sm:col-span-2" checked={checked} onChange={(e) => onChange(e.target.checked)} label={label} />
);
const useFieldErrors = () => {
  const [err, setErr] = useState<Record<string, string>>({});
  const onError = (e: unknown) => { if (e instanceof ApiError && e.fields) setErr(e.fields); };
  return { err, setErr, onError };
};

// ---------- clinic tab: name, branches, rooms ----------
export function ClinicSettings() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings').then((r) => r.data) });
  const b = useQuery({ queryKey: ['branches', 'all'], queryFn: () => api('/branches?active=all').then((r) => r.data as any[]) });
  const rooms = useQuery({ queryKey: ['rooms', 'all'], queryFn: () => api('/rooms?active=all').then((r) => r.data as any[]) });
  const [name, setName] = useState('');
  const [branch, setBranch] = useState<any | 'new' | null>(null);
  const [room, setRoom] = useState<any | 'new' | null>(null);
  useEffect(() => { if (s.data) setName(s.data.name); }, [s.data]);
  const m = useMutation({ mutationFn: () => api('/settings/clinic', { method: 'PATCH', body: { name: name.trim() } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['settings'] }); toast.success(t('admin.set.clinicSaved')); }, onError: (e) => toast.error(e) });
  if (s.isLoading) return <Card><LoadingRows rows={3} /></Card>;
  if (s.isError) return <Card><ErrorState error={s.error} onRetry={() => s.refetch()} /></Card>;
  const activeBranches = (b.data ?? []).filter((x) => x.active);
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
        <Card title={t('admin.set.clinic')}>
          <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name !== s.data?.name) m.mutate(); }}>
            <Field label={t('admin.set.clinicName')}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
            <div><Button type="submit" variant="primary" disabled={!name.trim() || name === s.data?.name} loading={m.isPending}>{t('common.save')}</Button></div>
          </form>
        </Card>
        <FiscalCard fiscal={s.data.fiscal} />
        <Card title={t('admin.set.branches')} padded={false} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setBranch('new')}>{t('settings.branches.add')}</Button>}>
          {b.isLoading ? <LoadingRows rows={2} /> : b.isError ? <ErrorState error={b.error} onRetry={() => b.refetch()} /> : (
            <ul className="divide-y divide-slate-100">{b.data!.map((x) => (
              <li key={x.id} className="flex items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900"><span>{x.name}</span><span className="text-small font-medium tabular-nums text-slate-600">{x.code}</span>
                    {!x.active && <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('settings.branches.inactive')}</Badge>}</div>
                  {(x.address || x.phone) && <div className="text-sm text-slate-600">{[x.address, x.phone ? formatPhone(x.phone) : null].filter(Boolean).join(' · ')}</div>}
                </div>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setBranch(x)} aria-label={`${t('settings.branches.edit')}: ${x.name}`}><span className="hidden md:inline">{t('settings.branches.edit')}</span></Button>
              </li>
            ))}</ul>
          )}
        </Card>
      </div>
      <Card title={t('admin.off.holidays')}><DaysOff clinic canEdit /></Card>
      <Card title={t('admin.set.rooms')} padded={false} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRoom('new')} disabled={!activeBranches.length}>{t('settings.rooms.add')}</Button>}>
        {rooms.isLoading ? <LoadingRows rows={4} /> : rooms.isError ? <ErrorState error={rooms.error} onRetry={() => rooms.refetch()} /> : !rooms.data!.length ? <EmptyState compact title={t('admin.set.noRooms')} /> : (
          <Table>
            <thead><tr><Th>{t('admin.set.colRoom')}</Th><Th>{t('admin.set.colPurpose')}</Th><Th className="hidden sm:table-cell">{t('admin.set.colBranch')}</Th><Th right><span className="sr-only">{t('admin.set.colActions')}</span></Th></tr></thead>
            <tbody>{rooms.data!.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setRoom(r)}>
                <Td className="whitespace-nowrap font-medium text-slate-900">{r.name}{!r.active && <div className="text-small font-normal text-slate-600">{t('settings.rooms.inactive')}</div>}</Td>
                <Td className="text-slate-700">{r.purpose}<div className="text-small text-slate-600 sm:hidden">{r.branch_name}</div></Td>
                <Td className="hidden whitespace-nowrap text-slate-700 sm:table-cell">{r.branch_name}</Td>
                <Td right className="w-px"><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={(e) => { e.stopPropagation(); setRoom(r); }} aria-label={`${t('admin.set.edit')}: ${r.name}`}><span className="hidden 2xl:inline">{t('admin.set.edit')}</span></Button></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      {branch && <BranchModal b={branch === 'new' ? null : branch} onClose={() => setBranch(null)} />}
      {room && <RoomModal r={room === 'new' ? null : room} branches={activeBranches} onClose={() => setRoom(null)} />}
    </div>
  );
}

/** Fiscal mode (ОФД) of the clinic — read-only here: the provider is set per deployment / clinic by the operator. */
function FiscalCard({ fiscal }: { fiscal: { provider: string; services_without_ikpu: number } }) {
  const t = useT();
  const { me } = useSession();
  const mode = fiscal.provider === 'manual' ? t('admin.set.fiscalParallel') : fiscal.provider === 'none' ? t('admin.set.fiscalNotConfigured') : t('admin.set.fiscalAuto', { name: fiscal.provider });
  return (
    <Card title={t('admin.set.fiscal')}>
      <div className="space-y-3">
        <KeyVal k={t('admin.set.fiscal')} v={<Badge tone={fiscal.provider === 'none' ? 'yellow' : 'green'}>{mode}</Badge>} />
        <p className="text-body text-slate-700">{fiscal.provider === 'manual' ? t('admin.set.fiscalManual') : fiscal.provider === 'none' ? t('admin.set.fiscalNone') : t('admin.set.fiscalAuto', { name: fiscal.provider })}</p>
        {/* IKPU codes matter for the receipt: a real clinic sees which services still lack one; the demo (none) has nothing to fiscalise */}
        {(fiscal.provider !== 'none' || !me.demo) && (fiscal.services_without_ikpu > 0
          ? <Alert tone="yellow">{t('admin.set.fiscalNoIkpu', { n: fiscal.services_without_ikpu })}</Alert>
          : <p className="text-small text-slate-600">{t('admin.set.fiscalAllIkpu')}</p>)}
      </div>
    </Card>
  );
}

function BranchModal({ b, onClose }: { b: any | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(b?.name ?? '');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState(b?.address ?? '');
  const [phone, setPhone] = useState(b?.phone ? formatPhone(b.phone) : '');
  const [active, setActive] = useState<boolean>(b?.active ?? true);
  const { err, onError } = useFieldErrors();
  const [tried, setTried] = useState(false);
  const nameErr = err.name ?? (tried && name.trim().length < 2 ? t('settings.branches.errName') : undefined);
  const m = useMutation({
    mutationFn: () => {
      const body: any = { name: name.trim(), address: address.trim() || null, phone: phone.trim() || null, active };
      if (b) return api(`/branches/${b.id}`, { method: 'PATCH', body });
      if (code.trim()) body.code = code.trim().toUpperCase();
      return api('/branches', { method: 'POST', body });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['branches'] }); qc.invalidateQueries({ queryKey: ['rooms'] }); qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(b ? (r.data.changes.length ? t('admin.set.savedChanges', { changes: r.data.changes.join(', ') }) : t('admin.set.noChanges')) : t('settings.branches.created', { code: r.data.code }));
      onClose();
    },
    onError: (e) => { onError(e); toast.error(e); },
  });
  const dirty = b ? name !== b.name || (address || '') !== (b.address || '') || active !== b.active || phone !== (b.phone ? formatPhone(b.phone) : '') : !!(name || address || phone || code);
  const save = () => { setTried(true); if (name.trim().length >= 2) m.mutate(); };
  return (
    <Modal open onClose={onClose} dirty={dirty} title={b ? t('settings.branches.editTitle', { name: b.name }) : t('settings.branches.addTitle')}
      footer={<><ModalCancel /><Button variant="primary" disabled={b ? !dirty : false} loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('settings.branches.name')} required className={b ? 'sm:col-span-2' : ''} error={nameErr}>{(id) => <Input id={id} data-autofocus value={name} invalid={!!nameErr} maxLength={80} onChange={(e) => setName(e.target.value)} />}</Field>
        {!b && <Field label={t('settings.branches.code')} hint={t('settings.branches.codeHint')} error={err.code}>{(id) => <Input id={id} value={code} invalid={!!err.code} maxLength={8} className="uppercase" onChange={(e) => setCode(e.target.value)} />}</Field>}
        <Field label={t('settings.branches.address')} className="sm:col-span-2" error={err.address}>{(id) => <Input id={id} value={address} invalid={!!err.address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />}</Field>
        <Field label={t('settings.branches.phone')} error={err.phone}>{(id) => <Input id={id} type="tel" inputMode="tel" value={phone} invalid={!!err.phone} placeholder="+998 90 123 45 67" onChange={(e) => setPhone(e.target.value)} />}</Field>
        {b && <ActiveCheck checked={active} onChange={setActive} label={t('settings.branches.activeCheck')} />}
        {err.active && <p className="text-sm font-medium text-red-700 sm:col-span-2" role="alert">{err.active}</p>}
      </div>
    </Modal>
  );
}

function RoomModal({ r, branches, onClose }: { r: any | null; branches: any[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(r?.name ?? '');
  const [branchId, setBranchId] = useState<string>(r?.branch_id ?? (branches.length === 1 ? branches[0].id : ''));
  const [purpose, setPurpose] = useState(r?.purpose ?? '');
  const [active, setActive] = useState<boolean>(r?.active ?? true);
  const { err, onError } = useFieldErrors();
  const [tried, setTried] = useState(false);
  const nameErr = err.name ?? (tried && !name.trim() ? t('settings.rooms.errName') : undefined);
  const branchErr = err.branch_id ?? (tried && !branchId ? t('settings.rooms.errBranch') : undefined);
  const m = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), branch_id: branchId, purpose: purpose.trim() || null, active };
      return r ? api(`/rooms/${r.id}`, { method: 'PATCH', body }) : api('/rooms', { method: 'POST', body });
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      toast.success(r ? (res.data.changes.length ? t('admin.set.savedChanges', { changes: res.data.changes.join(', ') }) : t('admin.set.noChanges')) : t('settings.rooms.created'));
      onClose();
    },
    onError: (e) => { onError(e); toast.error(e); },
  });
  const dirty = r ? name !== r.name || branchId !== r.branch_id || (purpose || '') !== (r.purpose || '') || active !== r.active : !!(name || purpose);
  const save = () => { setTried(true); if (name.trim() && branchId) m.mutate(); };
  // an edited room may sit in a branch that is now switched off: keep it selectable so the form still opens
  const options = r && !branches.some((b) => b.id === r.branch_id) ? [...branches, { id: r.branch_id, name: r.branch_name }] : branches;
  return (
    <Modal open onClose={onClose} dirty={dirty} title={r ? t('settings.rooms.editTitle', { name: r.name }) : t('settings.rooms.addTitle')}
      footer={<><ModalCancel /><Button variant="primary" disabled={r ? !dirty : false} loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('settings.rooms.name')} required error={nameErr}>{(id) => <Input id={id} data-autofocus value={name} invalid={!!nameErr} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t('settings.rooms.branch')} required error={branchErr}>{(id) => (
          <Select id={id} value={branchId} invalid={!!branchErr} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">—</option>{options.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>)}</Field>
        <Field label={t('settings.rooms.purpose')} className="sm:col-span-2" error={err.purpose}>{(id) => <Input id={id} value={purpose} invalid={!!err.purpose} maxLength={80} onChange={(e) => setPurpose(e.target.value)} />}</Field>
        {r && <ActiveCheck checked={active} onChange={setActive} label={t('settings.rooms.activeCheck')} />}
      </div>
    </Modal>
  );
}

// ---------- services tab ----------
export function ServicesSettings() {
  const t = useT();
  const q = useQuery({ queryKey: ['services', 'all'], queryFn: () => api('/services?active=all').then((r) => r.data as any[]) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches').then((r) => r.data as any[]) });
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((s) => !term || s.name.toLowerCase().includes(term) || String(s.code).toLowerCase().includes(term));
  return (
    <Card padded={false}>
      <Toolbar actions={<>
        <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setImporting(true)} data-testid="price-import-open" aria-label={t('settings.priceImport.open')} title={t('settings.priceImport.open')}><span className="hidden md:inline">{t('settings.priceImport.open')}</span></Button>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('settings.services.add')}</Button>
      </>}>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <Input type="search" aria-label={t('admin.set.searchService')} placeholder={t('admin.set.searchService')} className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Toolbar>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState compact title={t('admin.set.noServices')} /> : (
        <Table>
          <thead><tr>
            <Th className="hidden sm:table-cell">{t('admin.set.colCode')}</Th><Th>{t('admin.set.colService')}</Th><Th className="hidden lg:table-cell">{t('admin.set.colType')}</Th>
            <Th right>{t('admin.set.colPrice')}</Th><Th right className="hidden md:table-cell">{t('admin.set.colDuration')}</Th><Th right className="hidden lg:table-cell">{t('admin.set.colShare')}</Th>
            <Th className="hidden xl:table-cell">{t('settings.services.colIkpu')}</Th>
            <Th className="hidden sm:table-cell">{t('admin.set.colStatus')}</Th><Th right><span className="sr-only">{t('admin.set.colActions')}</span></Th>
          </tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEdit(s)}>
              <Td className="hidden whitespace-nowrap tabular-nums text-slate-600 sm:table-cell">{s.code}</Td>
              <Td className="min-w-[11rem]"><span className="font-semibold text-slate-900">{s.name}</span>
                {!s.active && <div className="text-small text-slate-600 sm:hidden">{t('admin.set.inactive')}</div>}</Td>
              <Td className="hidden whitespace-nowrap text-slate-700 lg:table-cell">{t(`service.${s.category}` as MessageKey)}</Td>
              <Td right className="font-medium text-slate-900">{formatSom(s.price)}</Td>
              <Td right className="hidden text-slate-700 md:table-cell">{t('admin.set.minutes', { n: s.duration_min })}</Td>
              <Td right className="hidden text-slate-700 lg:table-cell">{s.share_percent == null ? '—' : `${Number(s.share_percent)}%`}</Td>
              <Td className="hidden whitespace-nowrap tabular-nums text-slate-700 xl:table-cell">{s.ikpu_code ?? <span className="text-slate-500">—</span>}<span className="block text-small text-slate-600">{s.vat_exempt ? t('settings.services.vatExempt') : `${t('settings.services.vat')} ${s.vat_percent ?? 12}%`}</span></Td>
              <Td className="hidden sm:table-cell">{s.active ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('admin.set.active')}</Badge> : <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.set.inactive')}</Badge>}</Td>
              <Td right><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={(e) => { e.stopPropagation(); setEdit(s); }} aria-label={`${t('admin.set.edit')}: ${s.name}`}><span className="hidden md:inline">{t('admin.set.edit')}</span></Button></Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {edit && <ServiceModal s={edit === 'new' ? null : edit} branches={branches.data ?? []} onClose={() => setEdit(null)} />}
      {importing && <PriceImportModal onClose={() => setImporting(false)} />}
    </Card>
  );
}

/** Tiyin → the text a person types («150000» or «150000,50»), with integer arithmetic only. */
const tiyinToInput = (tiyin: number) => {
  const cents = tiyin % 100, som = (tiyin - cents) / 100;
  return cents ? `${som},${String(cents).padStart(2, '0')}` : String(som);
};

function ServiceModal({ s, branches, onClose }: { s: any | null; branches: any[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(s?.name ?? '');
  const [category, setCategory] = useState<string>(s?.category ?? 'consultation');
  const [price, setPrice] = useState(s ? tiyinToInput(Number(s.price)) : '');
  const [priceBranch, setPriceBranch] = useState('');
  const [dur, setDur] = useState(String(s?.duration_min ?? 30));
  const [share, setShare] = useState(String(s?.share_percent == null ? 0 : Number(s.share_percent)));
  const [active, setActive] = useState<boolean>(s?.active ?? true);
  // referral partner percent of this service (docs/REFERRALS.md): empty = each partner's own percent
  const [partnerPct, setPartnerPct] = useState<string>(s?.partner_percent == null ? '' : String(Number(s.partner_percent)));
  // fiscal attributes: IKPU (17 digits, may be empty until the clinic fills its catalogue) and the VAT choice
  const [ikpu, setIkpu] = useState<string>(s?.ikpu_code ?? '');
  const [vat, setVat] = useState<string>(s?.vat_exempt ? 'exempt' : s?.vat_percent == null ? '' : String(s.vat_percent));
  const [pkg, setPkg] = useState<string>(s?.package_code ?? '');
  const { err, onError } = useFieldErrors();
  const [tried, setTried] = useState(false);
  const p = parseSomToTiyin(price);
  const d = Number(dur);
  const sh = Number(share.replace(',', '.'));
  const pp = partnerPct.trim() === '' ? null : Number(partnerPct.replace(',', '.'));
  const show = tried || !!s;
  const local = {
    name: show && name.trim().length < 2 ? t('admin.set.errName') : undefined,
    price: (show || price) && p == null ? t('admin.set.badAmount') : undefined,
    duration_min: show && (!Number.isInteger(d) || d < 5 || d > 240) ? t('admin.set.badDuration') : undefined,
    share_percent: show && (!(sh >= 0 && sh <= 100) || share.trim() === '') ? t('settings.services.badShare') : undefined,
    ikpu_code: ikpu.trim() && !/^\d{17}$/.test(ikpu.trim()) ? t('settings.services.badIkpu') : undefined,
    partner_percent: pp != null && !(pp >= 0 && pp <= 100) ? t('ref.percentRange') : undefined,
  };
  const invalid = !!(local.name || local.price || local.duration_min || local.share_percent || local.ikpu_code || local.partner_percent);
  const fiscalBody = { ikpu_code: ikpu.trim() || null, vat_exempt: vat === 'exempt', vat_percent: vat === '' || vat === 'exempt' ? null : Number(vat), package_code: pkg.trim() || null };
  const m = useMutation({
    mutationFn: () => {
      const body: any = { name: name.trim(), category, duration_min: d, share_percent: sh, partner_percent: pp, active, ...fiscalBody };
      if (!s) return api('/services', { method: 'POST', body: { ...body, price: p } });
      // the price goes to the chosen branch only; the other fields are general
      if (p !== Number(s.price) || priceBranch) { body.price = p; if (priceBranch) body.branch_id = priceBranch; }
      return api(`/services/${s.id}`, { method: 'PATCH', body });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['services'] });
      toast.success(s ? (r.data.changes.length ? t('admin.set.savedChanges', { changes: r.data.changes.join(', ') }) : t('admin.set.noChanges')) : t('settings.services.created', { code: r.data.code }));
      onClose();
    },
    onError: (e) => { onError(e); toast.error(e); },
  });
  const save = () => { setTried(true); if (!invalid) m.mutate(); };
  const dirty = s
    ? name !== s.name || category !== s.category || p !== Number(s.price) || d !== s.duration_min || sh !== Number(s.share_percent ?? 0) || active !== s.active || !!priceBranch
      || pp !== (s.partner_percent == null ? null : Number(s.partner_percent))
      || fiscalBody.ikpu_code !== (s.ikpu_code ?? null) || fiscalBody.vat_exempt !== !!s.vat_exempt || fiscalBody.vat_percent !== (s.vat_percent ?? null) || fiscalBody.package_code !== (s.package_code ?? null)
    : !!(name || price);
  const e = (k: keyof typeof local) => err[k] ?? local[k];
  const vatLabel = (v: string) => v === '' ? t('settings.services.vatDefault') : v === 'exempt' ? t('settings.services.vatExempt') : v === '12' ? t('settings.services.vat12') : t('settings.services.vat0');
  return (
    <Modal open onClose={onClose} dirty={dirty} title={s ? t('admin.set.serviceTitle', { code: s.code }) : t('settings.services.addTitle')}
      footer={<><ModalCancel /><Button variant="primary" disabled={s ? !dirty : false} loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('admin.set.serviceName')} required className="sm:col-span-2" error={e('name')}>{(id) => <Input id={id} data-autofocus value={name} invalid={!!e('name')} maxLength={120} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t('settings.services.kind')} required error={err.category}>{(id) => (
          <Select id={id} value={category} invalid={!!err.category} onChange={(e) => setCategory(e.target.value)}>
            {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`service.${c}` as MessageKey)}</option>)}
          </Select>)}</Field>
        <Field label={t('admin.set.duration')} required error={e('duration_min')}>{(id) => <Input id={id} type="number" min={5} max={240} value={dur} invalid={!!e('duration_min')} onChange={(e) => setDur(e.target.value)} />}</Field>
        <Field label={t('admin.set.price')} required error={e('price')} hint={s ? t('admin.set.priceHint') : undefined}>{(id) => <MoneyInput id={id} value={price} invalid={!!e('price')} onChange={(e) => setPrice(e.target.value)} />}</Field>
        {s && branches.length > 1 ? (
          <Field label={t('settings.services.priceFor')} hint={priceBranch ? t('settings.services.branchPriceHint') : undefined} error={err.branch_id}>{(id) => (
            <Select id={id} value={priceBranch} onChange={(e) => setPriceBranch(e.target.value)}>
              <option value="">{t('settings.services.allBranches')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>)}</Field>
        ) : <div className="hidden sm:block" />}
        <Field label={t('settings.services.share')} required error={e('share_percent')}>{(id) => <Input id={id} type="number" inputMode="decimal" min={0} max={100} step={0.5} value={share} invalid={!!e('share_percent')} onChange={(e) => setShare(e.target.value)} />}</Field>
        <Field label={t('ref.servicePercent')} hint={t('ref.servicePercentHint')} error={e('partner_percent')}>{(id) => <Input id={id} inputMode="decimal" value={partnerPct} invalid={!!e('partner_percent')} placeholder={t('ref.servicePercentPlaceholder')} onChange={(e) => setPartnerPct(e.target.value)} />}</Field>
        <Field label={t('settings.services.ikpu')} hint={t('settings.services.ikpuHint')} error={e('ikpu_code')}>{(id) => <Input id={id} inputMode="numeric" maxLength={17} value={ikpu} invalid={!!e('ikpu_code')} onChange={(e) => setIkpu(e.target.value.replace(/\D/g, ''))} className="tabular-nums" />}</Field>
        <Field label={t('settings.services.vat')} error={err.vat_percent}>{(id) => <Select id={id} value={vat} onChange={(e) => setVat(e.target.value)}>{VAT_OPTIONS.map((v) => <option key={v} value={v}>{vatLabel(v)}</option>)}</Select>}</Field>
        <Field label={t('settings.services.packageCode')} error={err.package_code}>{(id) => <Input id={id} maxLength={40} value={pkg} onChange={(e) => setPkg(e.target.value)} />}</Field>
        <ActiveCheck checked={active} onChange={setActive} label={t('admin.set.activeCheck')} />
      </div>
    </Modal>
  );
}
