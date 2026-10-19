'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Newspaper, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Card, cx, EmptyState, LoadingRows, Select, useToast } from '@/components/ui';

type Item = { id: string; title: string; title_uz: string | null; summary_uz: string | null; takeaway_uz: string | null; journal: string | null; published: string | null; url: string; fetched_on: string; model: string | null; useful: boolean | null };
type Meta = { specialty: string; label: string; specialties: { key: string; label: string }[]; news_enabled: boolean; ai_mode: string };

/** «Bugun sohangizda»: recent high-evidence articles for the doctor's specialty, summarised in Uzbek. */
export function NewsCard({ canPick = false, canRate = true, initial = 3 }: { canPick?: boolean; canRate?: boolean; initial?: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [specialty, setSpecialty] = useState<string>('');
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['news', specialty], queryFn: () => api<{ data: Item[]; meta: Meta }>(`/news${specialty ? `?specialty=${specialty}` : ''}`), staleTime: 10 * 60_000 });
  const rate = useMutation({
    mutationFn: ({ id, useful }: { id: string; useful: boolean }) => api(`/news/${id}/feedback`, { method: 'POST', body: { useful } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['news'] }),
    onError: (e) => toast.error(e),
  });
  const items = q.data?.data ?? [];
  const meta = q.data?.meta;
  const shown = all ? items : items.slice(0, initial);

  return (
    <Card padded={false} title={<span className="flex items-center gap-2"><Newspaper className="h-4 w-4 text-brand-600" />Bugun sohangizda</span>}
      actions={canPick && meta ? (
        <Select aria-label="Mutaxassislik" className="h-7 w-auto text-xs" value={specialty || meta.specialty} onChange={(e) => setSpecialty(e.target.value)}>
          {meta.specialties.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
      ) : meta && <span className="text-xs text-slate-500">{meta.label}</span>}>
      {q.isLoading ? <LoadingRows rows={3} /> : !items.length ? (
        <EmptyState title="Bugungi maqolalar hali yuklanmagan" text={meta?.news_enabled === false ? 'Yangiliklar o‘chirilgan.' : 'Tizim har kuni PubMed’dan sohangiz bo‘yicha yangi tadqiqotlarni yig‘adi.'} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((n) => (
            <li key={n.id} className="px-4 py-3 text-[13px]">
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug text-slate-900 hover:text-brand-700 hover:underline">
                {n.title_uz ?? n.title}<ExternalLink className="ml-1 inline h-3 w-3 align-baseline text-slate-400" />
              </a>
              {!n.title_uz && <span className="ml-1 text-2xs text-slate-500">(asl sarlavha, AI qisqa mazmuni o‘chiq)</span>}
              {n.summary_uz && <p className="mt-1 leading-snug text-slate-700">{n.summary_uz}</p>}
              {n.takeaway_uz && <p className="mt-1 leading-snug text-slate-600"><b className="font-medium">Amaliyot uchun:</b> {n.takeaway_uz}</p>}
              <div className="mt-1.5 flex items-center gap-2 text-2xs text-slate-500">
                <span className="truncate">{[n.journal, n.published].filter(Boolean).join(' · ')}</span>
                {canRate && (
                  <span className="ml-auto flex shrink-0 gap-1">
                    <button type="button" aria-label="Foydali" title="Foydali" onClick={() => rate.mutate({ id: n.id, useful: true })}
                      className={cx('rounded p-1 hover:bg-slate-100', n.useful === true ? 'text-emerald-600' : 'text-slate-400')}><ThumbsUp className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label="Foydasiz" title="Foydasiz" onClick={() => rate.mutate({ id: n.id, useful: false })}
                      className={cx('rounded p-1 hover:bg-slate-100', n.useful === false ? 'text-red-600' : 'text-slate-400')}><ThumbsDown className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > initial && <button type="button" onClick={() => setAll((x) => !x)} className="w-full border-t border-slate-100 px-4 py-2 text-left text-xs font-medium text-brand-700 hover:bg-slate-50">{all ? 'Kamroq ko‘rsatish' : `Yana ${items.length - initial} ta maqola`}</button>}
      {items.length > 0 && (
        <p className="border-t border-slate-100 px-4 py-2 text-2xs leading-snug text-slate-500">
          Manba: PubMed (oxirgi 30 kun: RCT, meta-tahlil, sharh, tavsiyalar). {items.some((x) => x.model) ? 'Qisqa mazmunni AI annotatsiyadan tayyorlagan — xulosa uchun asl maqolani o‘qing. ' : ''}Davolash ko‘rsatmasi emas. Yangilangan: {fmtDate(items[0].fetched_on)}.
        </p>
      )}
    </Card>
  );
}
