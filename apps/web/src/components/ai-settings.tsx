'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, ErrorState, LoadingRows, Table, Td, Th, useToast } from '@/components/ui';
import { NewsCard } from '@/components/news-card';

type Usage = {
  mode: 'off' | 'sample' | 'live'; provider: 'anthropic' | 'gemini'; model: string; key_configured: boolean; gemini_free: boolean; clinical_allowed: boolean;
  by_route: { route: string; calls: number; ok: number; failed: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number; avg_latency_ms: number | null }[];
  today: { calls: number; cost_usd: number }; icd10: { n: number; official: number };
};
const ROUTE: Record<string, string> = { note_draft: 'Qaydni tartiblash', icd10_suggest: 'MKB-10 taklifi', news_summary: 'Yangiliklar qisqa mazmuni (barcha klinikalar uchun umumiy)' };
const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const PROVIDER = { anthropic: { name: 'Claude (Anthropic)', key: 'ANTHROPIC_API_KEY', console: 'Anthropic Console' }, gemini: { name: 'Gemini (Google)', key: 'GEMINI_API_KEY', console: 'Google AI Studio' } } as const;
const MODE: Record<Usage['mode'], [string, 'teal' | 'yellow' | 'gray']> = { live: ['Jonli AI', 'teal'], sample: ['Namunaviy rejim', 'yellow'], off: ['O‘chiq', 'gray'] };

/** Settings → AI: mode, model, 30-day usage and estimated cost, ICD-10 table status, news preview. */
export function AiSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ai-usage'], queryFn: () => api<{ data: Usage }>('/ai/usage').then((r) => r.data) });
  const refresh = useMutation({
    mutationFn: () => api<{ data: { specialty: string; added: number; error?: string }[] }>('/news/refresh', { method: 'POST' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['news'] }); qc.invalidateQueries({ queryKey: ['ai-usage'] });
      const added = r.data.reduce((a, b) => a + b.added, 0), failed = r.data.filter((x) => x.error).length;
      if (failed) toast.error(new Error(`${failed} ta soha yangilanmadi (PubMed yoki AI bilan aloqa yo‘q).`));
      else toast.success(added ? `${added} ta yangi maqola qo‘shildi` : 'Bugungi maqolalar allaqachon yuklangan');
    },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const u = q.data!;
  const total = u.by_route.reduce((a, b) => a + b.cost_usd, 0);
  const pv = PROVIDER[u.provider] ?? PROVIDER.anthropic;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-5">
        <section className="flex flex-wrap items-center gap-3">
          <Badge tone={MODE[u.mode][1]}>{MODE[u.mode][0]}</Badge>
          {u.mode === 'live' && <span className="text-sm text-slate-700">{pv.name} · <code>{u.model}</code>{u.gemini_free && ' · bepul tarif'}</span>}
          <span className="text-sm text-slate-600">Bugun: {u.today.calls} ta so‘rov, ~{usd(u.today.cost_usd)}</span>
        </section>
        {u.mode !== 'live' && (
          <Alert tone="yellow" title="Jonli AI ulanmagan">
            {u.key_configured ? 'Kalit bor, lekin AI_MODE=live emas.' : `Serverda ${pv.key} yo‘q.`} Hozir: qayd tartiblash faqat demo matni uchun namunaviy; MKB-10 taklifi so‘z bo‘yicha; yangiliklar asl sarlavha bilan.
          </Alert>
        )}
        {u.mode === 'live' && u.gemini_free && (
          <Alert tone={u.clinical_allowed ? 'yellow' : 'red'} title="Gemini bepul tarifi">
            Google bepul tarifdagi so‘rovlardan o‘z mahsulotlarini yaxshilash uchun foydalanishi mumkin.{' '}
            {u.clinical_allowed
              ? 'Demo klinikada ma’lumotlar sun’iy, shuning uchun ruxsat berilgan. Haqiqiy klinikaning qayd va MKB-10 so‘rovlari bepul tarifga yuborilmaydi.'
              : 'Shuning uchun qaydni tartiblash va MKB-10 taklifi o‘chirilgan (so‘z bo‘yicha qidiruv ishlaydi). Yangiliklar — ochiq maqolalar, ular ishlaydi.'}
          </Alert>
        )}
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Oxirgi 30 kun</h3>
          {!u.by_route.length ? <p className="mt-1 text-sm text-slate-500">AI hali chaqirilmagan.</p> : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <thead><tr><Th>Xizmat</Th><Th right>So‘rov</Th><Th right>Xato</Th><Th right>Token (kirish / chiqish)</Th><Th right>O‘rtacha vaqt</Th><Th right>~Narx</Th></tr></thead>
                <tbody>{u.by_route.map((r) => (
                  <tr key={r.route}>
                    <Td>{ROUTE[r.route] ?? r.route}</Td><Td right>{r.calls}</Td><Td right>{r.failed || '—'}</Td>
                    <Td right className="tabular-nums">{r.input_tokens.toLocaleString('ru-RU')} / {r.output_tokens.toLocaleString('ru-RU')}</Td>
                    <Td right>{r.avg_latency_ms != null ? `${(r.avg_latency_ms / 1000).toFixed(1)} s` : '—'}</Td><Td right className="tabular-nums">{usd(r.cost_usd)}</Td>
                  </tr>
                ))}</tbody>
                <tfoot><tr className="border-t border-slate-200 font-medium"><Td>Jami</Td><Td right>{u.by_route.reduce((a, b) => a + b.calls, 0)}</Td><Td /><Td /><Td /><Td right className="tabular-nums">{usd(total)}</Td></tr></tfoot>
              </Table>
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">{u.gemini_free ? 'Bepul tarif: to‘lov olinmaydi, narx 0 deb yoziladi.' : `Narx — ${pv.name} narxlari bo‘yicha taxmin.`} Aniq hisob {pv.console}’da. So‘rov matni va javoblar saqlanmaydi, faqat token soni.</p>
        </section>
        <section className="text-[13px] text-slate-600">
          <h3 className="text-sm font-semibold text-slate-900">MKB-10 ro‘yxati</h3>
          <p className="mt-1">{u.icd10.n} ta kod{u.icd10.official ? `, shundan ${u.icd10.official} tasi rasmiy ro‘yxatdan` : ' — boshlang‘ich ro‘yxat (eng ko‘p uchraydigan ambulator tashxislar)'}.
            {!u.icd10.official && <> Rasmiy ro‘yxatni administrator yuklaydi: <code>npm run db:import-icd10 -- fayl.csv</code>.</>}</p>
        </section>
        <section className="text-[13px] text-slate-600">
          <h3 className="text-sm font-semibold text-slate-900">Xavfsizlik</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>AI’ga yuborishdan oldin bemorning ismi, telefoni, tug‘ilgan sanasi va ID raqami olib tashlanadi.</li>
            <li>AI faqat loyiha tayyorlaydi: qaydni shifokor tekshiradi va tasdiqlaydi. MKB-10 kodi faqat klinika ro‘yxatidan, tanlovni shifokor qiladi.</li>
            <li>AI xatosi yoki o‘chiqligi ishni to‘xtatmaydi — har bir funksiya qo‘lda ishlashda davom etadi.</li>
          </ul>
        </section>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Shifokorlar uchun yangiliklar</h3>
          <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>Hozir yangilash</Button>
        </div>
        <NewsCard canPick canRate={false} initial={5} />
      </div>
    </div>
  );
}
