'use client';
import { forwardRef } from 'react';
import { formatSom, parseSomToTiyin } from '@/lib/format';
import { cx, Input } from '@/components/ui';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'className' | 'size'> & {
  size?: 'md' | 'sm';
  value: string;
  /** an outside error (e.g. «more than the amount due») also marks the field red */
  invalid?: boolean;
  /** width of the field (rem classes); the input fills it */
  className?: string;
};

/**
 * A so‘m amount field: right-aligned tabular digits, red border while the text is not a number, and the parsed
 * amount echoed underneath with grouping and the currency word («= 1 350 000 so‘m»), so a long number is easy to check.
 */
export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput({ value, invalid, className, ...rest }, ref) {
  const tiyin = value.trim() ? parseSomToTiyin(value) : null;
  const bad = invalid || (!!value.trim() && tiyin == null);
  const echo = tiyin != null && tiyin > 0 && value.replace(/\D/g, '').length >= 4;
  return (
    <div className={cx('flex flex-col gap-0.5', className ?? 'w-full')}>
      <Input ref={ref} inputMode="decimal" autoComplete="off" {...rest} value={value} invalid={bad} className="text-right text-base tabular-nums" />
      {echo && <span aria-hidden="true" className="text-right text-small tabular-nums text-slate-600">= {formatSom(tiyin)}</span>}
    </div>
  );
});
