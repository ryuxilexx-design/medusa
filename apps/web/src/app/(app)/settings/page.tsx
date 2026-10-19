'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, RotateCcw } from 'lucide-react';
import { ROLE_LABEL, SERVICE_CATEGORY_LABEL } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, formatSom, parseSomToTiyin } from '@/lib/format';
import { useSession } from '@/lib/session';
import { TelegramSettings } from '@/components/telegram-settings';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, LoadingRows, Modal, PageHeader, Pagination, Table, Tabs, Td, Th, useToast } from '@/components/ui';

type Tab = 'clinic' | 'services' | 'telegram' | 'audit' | 'demo';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('clinic');
  return (
    <>
      <PageHeader title="Sozlamalar" subtitle="Klinika, xizmat katalogi, Telegram bot, audit va demo boshqaruvi" />
      <Card padded={false}>
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} items={[{ value: 'clinic', label: 'Klinika va filiallar' }, { value: 'services', label: 'Xizmatlar katalogi' }, { value: 'telegram', label: 'Telegram bot' }, { value: 'audit', label: 'Audit jurnali' }, { value: 'demo', label: 'Demo boshqaruvi' }]} /></div>
        <div className="p-4">
          {tab === 'clinic' && <Clinic />}
          {tab === 'services' && <Services />}
          {tab === 'telegram' && <TelegramSettings />}
          {tab === 'audit' && <Audit />}
          {tab === 'demo' && <Demo />}
        </div>
      </Card>
    </>
  );
}

function Clinic() {
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings').then((r) => r.data) });
  const b = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches').then((r) => r.data as any[]) });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api('/rooms').then((r) => r.data as any[]) });
  const [name, setName] = useState('');
  useEffect(() => { if (s.data) setName(s.data.name); }, [s.data]);
  const m = useMutation({ mutationFn: () => api('/settings/clinic', { method: 'PATCH', body: { name } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Klinika nomi saqlandi'); }, onError: (e) => toast.error(e) });
  if (s.isLoading) return <LoadingRows rows={3} />;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <Field label="Klinika nomi" hint="Haqiqiy klinika nomi berilsa shu yerda almashtiriladi. Mahsulot nomi — Med.uz.ai.">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Button variant="primary" disabled={!name.trim() || name === s.data?.name} loading={m.isPending} onClick={() => m.mutate()}>Saqlash</Button>
        <h3 className="pt-4 text-sm font-semibold">Filiallar</h3>
        <ul className="divide-y rounded-md border text-sm">{b.data?.map((x) => <li key={x.id} className="px-3 py-2"><b>{x.name}</b> <span className="text-slate-500">· {x.code} · {x.address} · {x.timezone}</span></li>)}</ul>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Xonalar</h3>
        <ul className="divide-y rounded-md border text-sm">{rooms.data?.map((r) => <li key={r.id} className="flex justify-between px-3 py-1.5"><span>{r.name} · {r.purpose}</span><span className="text-slate-500">{r.branch_name}</span></li>)}</ul>
        <p className="mt-3 text-xs text-slate-500">Shifokor jadvali, xona biriktirish, logotip va shablon maydonlarini tahrirlash — keyingi relizda.</p>
      </div>
    </div>
  );
}

function Services() {
  const q = useQuery({ queryKey: ['services', 'all'], queryFn: () => api('/services?active=all').then((r) => r.data as any[]) });
  const [edit, setEdit] = useState<any>(null);
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <Alert tone="blue">Narx o‘zgarishi faqat keyingi buyurtmalarga ta’sir qiladi; eski hisoblarda narx snapshoti saqlanadi. Foydalanilgan xizmat o‘chirilmaydi — nofaol qilinadi.</Alert>
      <Table className="mt-3">
        <thead><tr><Th>Kod</Th><Th>Xizmat</Th><Th>Turi</Th><Th right>Narx</Th><Th right>Davomiylik</Th><Th right>Ulush %</Th><Th>Holat</Th><Th right /></tr></thead>
        <tbody>{q.data!.map((s) => (
          <tr key={s.id} className="hover:bg-slate-50">
            <Td className="tabular-nums text-slate-500">{s.code}</Td><Td className="font-medium">{s.name}</Td><Td><Badge>{SERVICE_CATEGORY_LABEL[s.category]}</Badge></Td>
            <Td right>{formatSom(s.price)}</Td><Td right>{s.duration_min} daq.</Td><Td right>{Number(s.share_percent)}</Td>
            <Td>{s.active ? <Badge tone="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
            <Td right><Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(s)}>Tahrirlash</Button></Td>
          </tr>
        ))}</tbody>
      </Table>
      {edit && <ServiceModal s={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ServiceModal({ s, onClose }: { s: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(s.name);
  const [price, setPrice] = useState(String(s.price / 100));
  const [dur, setDur] = useState(String(s.duration_min));
  const [active, setActive] = useState<boolean>(s.active);
  const [err, setErr] = useState<Record<string, string>>({});
  const p = parseSomToTiyin(price);
  const m = useMutation({
    mutationFn: () => api(`/services/${s.id}`, { method: 'PATCH', body: { name, price: p, duration_min: Number(dur), active } }),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['services'] }); toast.success(r.data.changes.length ? `Saqlandi: ${r.data.changes.join(', ')}` : 'O‘zgarish yo‘q'); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const dirty = name !== s.name || p !== s.price || Number(dur) !== s.duration_min || active !== s.active;
  return (
    <Modal open onClose={onClose} dirty={dirty} title={`Xizmat: ${s.code}`} footer={<><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" disabled={!dirty || p == null || !name.trim()} loading={m.isPending} onClick={() => m.mutate()}>Saqlash</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nomi" required className="col-span-2" error={err.name}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Narx (so‘m)" required error={err.price ?? (p == null ? 'Noto‘g‘ri summa' : undefined)}>{(id) => <Input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
        <Field label="Davomiylik (daq.)" required error={err.duration_min}>{(id) => <Input id={id} type="number" min={5} max={240} value={dur} onChange={(e) => setDur(e.target.value)} />}</Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={active} onChange={(e) => setActive(e.target.checked)} />Faol (nofaol xizmat yangi buyurtmada ko‘rinmaydi)</label>
      </div>
    </Modal>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', page], queryFn: () => api(`/audit?page=${page}&page_size=20`), placeholderData: (p) => p });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <Table>
        <thead><tr><Th>Vaqt</Th><Th>Xodim</Th><Th>Amal</Th><Th>Tafsilot</Th></tr></thead>
        <tbody>{q.data.data.map((a: any) => (
          <tr key={a.id}><Td className="whitespace-nowrap tabular-nums">{fmtDateTime(a.occurred_at)}</Td><Td>{a.actor_name} <span className="text-xs text-slate-500">{ROLE_LABEL[a.actor_role as keyof typeof ROLE_LABEL] ?? ''}</span></Td><Td><code className="rounded bg-slate-100 px-1 text-xs">{a.action}</code></Td><Td className="text-slate-700">{a.summary}</Td></tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
      <p className="mt-2 text-xs text-slate-500">Auditga to‘liq klinik matn yoki AI so‘rovi yozilmaydi.</p>
    </>
  );
}

function Demo() {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const m = useMutation({
    mutationFn: () => api('/demo/reset', { method: 'POST' }),
    onSuccess: () => { qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' }); qc.invalidateQueries({ queryKey: ['me'] }); setConfirm(false); setTyped(''); toast.success('Demo ma’lumotlari boshlang‘ich holatga tiklandi'); },
    onError: (e) => toast.error(e),
  });
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-slate-700">Demo sanasi: <b>{me.today}</b>. Tiklash deterministik seed’ni qayta yuklaydi: 100 bemor, 240 qabul, 180 hisob va bog‘langan yozuvlar. Sizning sessiyangiz saqlanadi.</p>
      <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm(true)}>Demo ma’lumotlarini tiklash</Button>
      <Modal open={confirm} onClose={() => !m.isPending && setConfirm(false)} title="Demo ma’lumotlarini tiklash"
        footer={<><Button onClick={() => setConfirm(false)} disabled={m.isPending}>Bekor qilish</Button><Button variant="danger" disabled={typed.trim().toUpperCase() !== 'TIKLASH'} loading={m.isPending} onClick={() => m.mutate()}>Tiklash</Button></>}>
        <Alert tone="red" title="Joriy demo o‘zgarishlari o‘chadi">Namoyish davomida yaratilgan bemorlar, qabullar, to‘lovlar va qaydlar o‘chiriladi.</Alert>
        <Field label="Tasdiqlash uchun TIKLASH deb yozing" className="mt-3">{(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}</Field>
      </Modal>
    </div>
  );
}
