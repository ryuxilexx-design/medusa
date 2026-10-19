/**
 * Med.uz.ai brand: jellyfish "M" mark (vector redraw of docs/brand/meduzai-logo-original.png) and wordmark.
 * Coordinates follow the original artwork so proportions stay faithful.
 */
export function BrandMark({ className = 'h-8 w-8', title, compact = false }: { className?: string; title?: string; compact?: boolean }) {
  const g = compact ? 'medgrad-c' : 'medgrad';
  const w = (n: number) => String(Math.round(n * (compact ? 1.7 : 1))); // thicker lines stay visible at 16–32 px
  return (
    <svg viewBox="455 195 690 845" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={g} x1="470" y1="215" x2="1130" y2="1030" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3b6cc4" />
          <stop offset="1" stopColor="#6cc2ec" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M505 552 C503 470 560 392 642 385 C598 420 578 482 572 556 Z" fill="#cfe0f5" stroke="none" />
        <path d="M1095 552 C1097 470 1040 392 958 385 C1002 420 1022 482 1028 556 Z" fill="#cfe0f5" stroke="none" />
        <path d="M563 582 C515 582 472 555 472 490 C472 330 640 215 800 215 C960 215 1128 330 1128 490 C1128 555 1085 582 1037 582" stroke={`url(#${g})`} strokeWidth={w(36)} />
        <path d="M643 600 C622 660 522 700 522 790 C522 870 570 935 583 1015" stroke={`url(#${g})`} strokeWidth={w(13)} />
        <path d="M957 600 C978 660 1078 700 1078 790 C1078 870 1030 935 1017 1015" stroke={`url(#${g})`} strokeWidth={w(13)} />
        <path d="M700 578 C732 640 722 690 692 740 C662 790 660 832 662 885" stroke={`url(#${g})`} strokeWidth={w(14)} />
        <path d="M900 578 C868 640 878 690 908 740 C938 790 940 832 938 885" stroke={`url(#${g})`} strokeWidth={w(14)} />
        <path d="M800 525 V 990" stroke={`url(#${g})`} strokeWidth={w(14)} />
        <path d="M643 600 V 445 C643 410 682 398 703 420 L 800 522 L 897 420 C918 398 957 410 957 445 V 600" stroke="#3f72c9" strokeWidth={w(36)} />
      </g>
      <circle cx="662" cy="888" r="30" fill="#5aa6e2" />
      <circle cx="938" cy="888" r="30" fill="#62b4e8" />
      <circle cx="800" cy="997" r="33" fill="#64b6e8" />
    </svg>
  );
}

export const BRAND_NAME = 'Med.uz.ai';

/** Text wordmark: "Med.uz" navy + ".ai" blue, as in the logo. */
export function BrandWordmark({ className = 'text-[18px]' }: { className?: string }) {
  return <span className={`font-bold tracking-tight ${className}`}><span className="text-[#1f3b78]">Med.uz</span><span className="text-[#4a86d6]">.ai</span></span>;
}

export function BrandLockup({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2">
      <BrandMark compact={size !== 'lg'} className={size === 'lg' ? 'h-12 w-12' : 'h-8 w-8'} />
      <BrandWordmark className={size === 'lg' ? 'text-[24px]' : 'text-[18px]'} />
    </span>
  );
}
