'use client';
import { useT } from '@/lib/i18n';
import { cx, Input } from './ui';

/** «from – to» pair of native date inputs, wide enough for the full year next to the calendar icon. */
export function DateRange({ from, to, onFrom, onTo, className }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; className?: string }) {
  const t = useT();
  const w = 'w-full min-w-0 sm:w-[9.75rem]';
  return (
    // phone: two equal columns (the dash would be left dangling at the end of a wrapped line)
    <div className={cx('grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center', className)} role="group" aria-label={t('clinical.period.group')}>
      <Input type="date" aria-label={t('clinical.period.from')} className={w} value={from} max={to} onChange={(e) => e.target.value && onFrom(e.target.value)} />
      <span className="hidden text-slate-600 sm:inline" aria-hidden="true">–</span>
      <Input type="date" aria-label={t('clinical.period.to')} className={w} value={to} min={from} onChange={(e) => e.target.value && onTo(e.target.value)} />
    </div>
  );
}
