'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartHandshake, Printer, Send } from 'lucide-react';
import type { MessageKey, SummaryLanguage } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, Checkbox, ErrorState, LinkButton, LoadingRows, Modal, ModalCancel, Skeleton, Tabs, Textarea, type Tone, useToast } from '@/components/ui';
import { useT } from '@/lib/i18n';

type Summary = { id: string; version: number; language: SummaryLanguage; text: string; approved_by_name: string; approved_at: string; send_requested: boolean;
  channel: 'telegram' | 'sms' | null; delivery_status: 'pending' | 'sent' | 'failed' | 'skipped' | null };
type ListMeta = { channel: 'telegram' | 'sms' | null; default_language: SummaryLanguage; note_signed: boolean };
type Draft = { mode: 'live' | 'sample' | 'off'; text: string; dropped: number; reason: string | null; language: SummaryLanguage };
const LANG: Record<SummaryLanguage, MessageKey> = { uz: 'ps.lang.uz', 'uz-Cyrl': 'ps.lang.uzCyrl', ru: 'ps.lang.ru' };
const TAB: Record<SummaryLanguage, MessageKey> = { uz: 'ps.tab.uz', 'uz-Cyrl': 'ps.tab.uzCyrl', ru: 'ps.tab.ru' };
const STATUS_TONE: Record<string, Tone> = { sent: 'green', pending: 'blue', failed: 'red', skipped: 'yellow' };

/**
 * Under a signed note: the plain-language summary for the patient. The doctor makes a draft (AI or template),
 * edits it, approves it (a new immutable version) and may send it — the text to the patient's own Telegram chat, or
 * by SMS only «it is ready». Every version prints on A5.
 */
export function PatientSummaryCard({ encounterId }: { encounterId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['patient-summaries', encounterId], queryFn: () => api<{ data: Summary[]; meta: ListMeta }>(`/encounters/${encounterId}/patient-summaries`) });
  return (
    <Card title={t('ps.versions')} actions={<Button size="sm" icon={<HeartHandshake className="h-4 w-4 text-brand-600" />} data-testid="ps-open" onClick={() => setOpen(true)}>{t('ps.button')}</Button>}>
      {q.isLoading ? <LoadingRows rows={1} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? <p className="text-sm text-slate-600">{t('ps.none')}</p> : (
        <ul className="divide-y divide-slate-100" data-testid="ps-list">
          {q.data.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-semibold">{t('ps.version', { n: s.version })}</span>
              <span className="text-slate-700">{t(LANG[s.language])}</span>
              <span className="text-small text-slate-600">{s.approved_by_name}, {fmtDateTime(s.approved_at)}</span>
              {s.delivery_status ? <Badge tone={STATUS_TONE[s.delivery_status]}>{t(s.channel === 'sms' ? 'ps.ch.sms' : 'ps.ch.telegram')} · {t(`ps.st.${s.delivery_status}` as MessageKey)}</Badge> : <Badge>{t('ps.st.none')}</Badge>}
              <span className="ml-auto"><LinkButton size="sm" target="_blank" href={`/print/summary/${s.id}`} icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton></span>
            </li>
          ))}
        </ul>
      )}
      {open && q.data && <SummaryModal encounterId={encounterId} meta={q.data.meta} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function SummaryModal({ encounterId, meta, onClose }: { encounterId: string; meta: ListMeta; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [lang, setLang] = useState<SummaryLanguage>(meta.default_language);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [send, setSend] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = useMutation({
    mutationFn: () => api<{ data: Draft }>(`/encounters/${encounterId}/patient-summary/draft`, { method: 'POST', body: { language: lang } }).then((r) => r.data),
    onSuccess: (d) => { setDraft(d); setText(d.text); setView('edit'); setError(null); },
    onError: (e) => setError(t('ps.failed', { msg: (e as Error).message })),
  });
  useEffect(() => { setConfirm(false); }, [send]);
  const approve = useMutation({
    mutationFn: () => api<{ data: Summary }>(`/encounters/${encounterId}/patient-summaries`, { method: 'POST',
      body: { language: draft?.language ?? lang, text, draft_source: draft?.mode === 'live' ? 'live' : draft?.mode === 'sample' ? 'sample' : 'template', send, confirm_send: send ? confirm : undefined } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['patient-summaries', encounterId] });
      toast.success(r.data.channel ? t('ps.approvedSent') : t('ps.approved'));
      onClose();
    },
    // the text stays in the box; the reason is shown above it
    onError: (e) => setError(e instanceof ApiError && e.fields ? Object.values(e.fields).join(' ') : (e as Error).message),
  });
  const via = meta.channel === 'telegram' ? t('ps.viaTelegram') : meta.channel === 'sms' ? t('ps.viaSms') : t('ps.viaNone');
  const label = draft?.mode === 'live' ? <Badge tone="teal" className="!whitespace-normal">{t('ps.live')}</Badge> : draft?.mode === 'sample' ? <Badge tone="yellow" className="!whitespace-normal">{t('ps.sample')}</Badge>
    : draft ? <Badge className="!whitespace-normal">{draft.reason ? t('ps.templateReason', { reason: draft.reason }) : t('ps.template')}</Badge> : null;
  const canApprove = text.trim().length >= 20 && (!send || confirm);
  return (
    <Modal open onClose={onClose} width="max-w-3xl" dirty={!!text.trim() && !approve.isPending} title={t('ps.title')}
      footer={<><ModalCancel /><Button variant="primary" icon={send ? <Send className="h-4 w-4" /> : undefined} loading={approve.isPending} disabled={!canApprove} data-testid="ps-approve"
        onClick={() => { setError(null); approve.mutate(); }}>{send ? t('ps.approveSend') : t('ps.approve')}</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <div className="min-w-0">
            <span className="mb-1 block text-sm font-semibold text-slate-800">{t('ps.language')}</span>
            <Tabs value={lang} onChange={setLang} items={(['uz', 'uz-Cyrl', 'ru'] as const).map((l) => ({ value: l, label: t(TAB[l]) }))} />
          </div>
          <Button size="sm" loading={make.isPending} onClick={() => make.mutate()} data-testid="ps-make">{draft ? t('ps.remake') : t('ps.make')}</Button>
        </div>
        {error && <Alert tone="red">{error}</Alert>}
        {make.isPending ? <div className="space-y-2"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-40" /></div> : !draft && !text ? (
          <p className="rounded-lg border-2 border-dashed border-slate-300 p-8 text-center text-body text-slate-600">{t('ps.empty')}</p>
        ) : <>
          <div className="flex flex-wrap items-center gap-2">
            {label}
            {draft && draft.dropped > 0 && <Badge tone="yellow" className="!whitespace-normal">{t('ps.dropped', { n: draft.dropped })}</Badge>}
            <span className="ml-auto"><Tabs value={view} onChange={setView} items={[{ value: 'edit', label: t('ps.tabEdit') }, { value: 'preview', label: t('ps.tabPreview') }]} /></span>
          </div>
          {draft && draft.mode !== 'live' && draft.language !== 'uz' && <p className="text-small text-slate-600">{t('ps.templateLang')}</p>}
          {view === 'edit'
            ? <Textarea aria-label={t('ps.text')} data-testid="ps-text" rows={9} className="min-h-[12rem]" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
            : <div className="max-h-[18rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-body leading-relaxed text-slate-900" data-testid="ps-preview">{text}</div>}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <Checkbox checked={send} disabled={!meta.channel} onChange={(e) => setSend(e.target.checked)} data-testid="ps-send" label={<span className="font-semibold">{t('ps.send')}</span>} hint={via} />
            {send && <Checkbox rowClassName="font-medium" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="ps-confirm" label={t('ps.confirmSend')} />}
          </div>
        </>}
      </div>
    </Modal>
  );
}
