import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from './ui';

export function refText(v: any) {
  if (v.ref_low != null && v.ref_high != null) return `${v.ref_low} – ${v.ref_high}`;
  if (v.ref_high != null) return `≤ ${v.ref_high}`;
  if (v.ref_low != null) return `≥ ${v.ref_low}`;
  return '—';
}

/** Result table. Out-of-range values are marked with text + arrow, not colour alone. */
export function LabValues({ values, compact }: { values: any[]; compact?: boolean }) {
  if (compact) return (
    <ul className="text-[13px]">
      {values.map((v) => (
        <li key={v.code} className="flex items-baseline justify-between gap-2 border-t border-slate-100 py-0.5" title={`Namunaviy referens: ${refText(v)}`}>
          <span className="truncate">{v.name}</span>
          <span className={cx('shrink-0 tabular-nums', v.flag === 'high' || v.flag === 'low' ? 'font-semibold text-red-700' : 'text-slate-800')}>
            {v.value || '—'} <span className="text-2xs font-normal text-slate-500">{v.unit}</span>
            {v.flag === 'high' && <span className="ml-1 text-2xs">↑ yuqori</span>}{v.flag === 'low' && <span className="ml-1 text-2xs">↓ past</span>}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <table className={cx('w-full text-sm', compact && 'text-[13px]')}>
      <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-2 font-semibold">Parametr</th><th className="py-1 pr-2 text-right font-semibold">Natija</th><th className="py-1 pr-2 font-semibold">Birlik</th><th className="py-1 pr-2 font-semibold">Namunaviy referens</th><th className="py-1 font-semibold">Belgi</th></tr></thead>
      <tbody>
        {values.map((v) => (
          <tr key={v.code} className="border-t border-slate-100">
            <td className="py-1 pr-2">{v.name}</td>
            <td className={cx('py-1 pr-2 text-right font-medium tabular-nums', v.flag === 'high' || v.flag === 'low' ? 'text-red-700' : 'text-slate-900')}>{v.value || '—'}</td>
            <td className="py-1 pr-2 text-slate-500">{v.unit}</td>
            <td className="py-1 pr-2 tabular-nums text-slate-500">{refText(v)}</td>
            <td className="py-1 text-xs">{v.flag === 'high' ? <span className="inline-flex items-center gap-0.5 font-medium text-red-700"><ArrowUp className="h-3 w-3" />Yuqori</span> : v.flag === 'low' ? <span className="inline-flex items-center gap-0.5 font-medium text-red-700"><ArrowDown className="h-3 w-3" />Past</span> : v.flag === 'normal' ? <span className="text-slate-500">Me’yorda</span> : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
