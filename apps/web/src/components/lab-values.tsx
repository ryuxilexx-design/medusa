import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from './ui';
import { useT } from '@/lib/i18n';

export function refText(v: any) {
  if (v.ref_low != null && v.ref_high != null) return `${v.ref_low} – ${v.ref_high}`;
  if (v.ref_high != null) return `≤ ${v.ref_high}`;
  if (v.ref_low != null) return `≥ ${v.ref_low}`;
  return '—';
}

/** Result table. Out-of-range values are marked with text + arrow, not colour alone. */
export function LabValues({ values, compact }: { values: any[]; compact?: boolean }) {
  const t = useT();
  if (compact) return (
    <ul className="text-[0.8125rem]">
      {values.map((v) => (
        <li key={v.code} className="flex items-baseline justify-between gap-2 border-t border-slate-100 py-0.5" title={t('lab.referenceTitle', { ref: refText(v) })}>
          <span className="truncate">{v.name}</span>
          <span className={cx('shrink-0 tabular-nums', v.flag === 'high' || v.flag === 'low' ? 'font-semibold text-red-700' : 'text-slate-800')}>
            {v.value || '—'} <span className="text-2xs font-normal text-slate-500">{v.unit}</span>
            {v.flag === 'high' && <span className="ml-1 text-2xs">{t('lab.highShort')}</span>}{v.flag === 'low' && <span className="ml-1 text-2xs">{t('lab.lowShort')}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <table className={cx('w-full text-sm', compact && 'text-[0.8125rem]')}>
      <thead><tr className="text-left text-[0.8125rem] text-slate-600"><th className="py-1 pr-2 font-semibold">{t('lab.param')}</th><th className="py-1 pr-2 text-right font-semibold">{t('lab.result')}</th><th className="py-1 pr-2 font-semibold">{t('lab.unit')}</th><th className="py-1 pr-2 font-semibold">{t('lab.reference')}</th><th className="py-1 font-semibold">{t('lab.flag')}</th></tr></thead>
      <tbody>
        {values.map((v) => (
          <tr key={v.code} className="border-t border-slate-100">
            <td className="py-1 pr-2">{v.name}</td>
            <td className={cx('py-1 pr-2 text-right font-medium tabular-nums', v.flag === 'high' || v.flag === 'low' ? 'text-red-700' : 'text-slate-900')}>{v.value || '—'}</td>
            <td className="py-1 pr-2 text-slate-500">{v.unit}</td>
            <td className="py-1 pr-2 tabular-nums text-slate-500">{refText(v)}</td>
            <td className="py-1 text-xs">{v.flag === 'high' ? <span className="inline-flex items-center gap-0.5 font-medium text-red-700"><ArrowUp className="h-3 w-3" />{t('lab.high')}</span> : v.flag === 'low' ? <span className="inline-flex items-center gap-0.5 font-medium text-red-700"><ArrowDown className="h-3 w-3" />{t('lab.low')}</span> : v.flag === 'normal' ? <span className="text-slate-600">{t('lab.normal')}</span> : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
