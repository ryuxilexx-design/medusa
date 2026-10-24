'use client';
import type { MessageKey } from '@meduza/contracts';
import { cx, Radio } from '@/components/ui';
import { useT } from '@/lib/i18n';

/**
 * Putting pre-written text (an AI draft, a note template) into the note: an empty field is filled, an identical one is
 * left alone, a field the doctor already typed in asks — keep, replace or append. Shared by the AI modal and the
 * template modal so the doctor meets one behaviour.
 */
export type Choice = 'keep' | 'replace' | 'append';
export type Plan = 'fill' | 'same' | 'none' | 'ask';

export function planOf(draft: string, current: string): Plan {
  const v = draft.trim(), cur = current.trim();
  return !v ? 'none' : !cur ? 'fill' : cur === v ? 'same' : 'ask';
}

/** The fields that change when the doctor applies: empty ones get the text, asked ones follow the choice (default keep). */
export function applyFields<K extends string>(keys: readonly K[], draftOf: (k: K) => string, current: Record<K, string>, choice: Partial<Record<K, Choice>>): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) {
    const plan = planOf(draftOf(k), current[k]), c = choice[k] ?? 'keep';
    if (plan === 'fill') out[k] = draftOf(k).trim();
    else if (plan === 'ask' && c === 'replace') out[k] = draftOf(k).trim();
    else if (plan === 'ask' && c === 'append') out[k] = `${current[k].trim()}\n${draftOf(k).trim()}`;
  }
  return out;
}

export function FieldApplyList<K extends string>({ fields, draftOf, current, choice, onChoice, testIdPrefix }: {
  fields: readonly { key: K; label: string }[]; draftOf: (k: K) => string; current: Record<K, string>;
  choice: Partial<Record<K, Choice>>; onChoice: (k: K, c: Choice) => void; testIdPrefix: string;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      {fields.map((f) => {
        const text = draftOf(f.key).trim();
        const plan = planOf(text, current[f.key]);
        return (
          <div key={f.key} className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-small font-semibold text-slate-600">{f.label}</div>
            <div className={cx('whitespace-pre-wrap text-body', !text && 'text-slate-500')}>{text || t('common.notEntered')}</div>
            {plan === 'fill' && <div className="mt-1 text-small text-emerald-800">{t('ai.toEmpty')}</div>}
            {plan === 'same' && <div className="mt-1 text-small text-slate-600">{t('ai.same')}</div>}
            {plan === 'ask' && (
              <fieldset className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid={`${testIdPrefix}-${f.key}`}>
                <legend className="mb-1 font-medium text-amber-900">{t('ai.hasText')}</legend>
                {(['keep', 'replace', 'append'] as Choice[]).map((c) => (
                  <Radio key={c} name={`${testIdPrefix}-${f.key}`} rowClassName="text-sm" checked={(choice[f.key] ?? 'keep') === c} onChange={() => onChoice(f.key, c)} label={t(`ai.${c}` as MessageKey)} />
                ))}
              </fieldset>
            )}
          </div>
        );
      })}
    </div>
  );
}
