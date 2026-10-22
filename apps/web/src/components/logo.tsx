/**
 * Med.uz.ai brand (2026-10-22 artwork, docs/brand/meduzai-logo-2026-10-22.png): the jellyfish mark is the original
 * raster with a transparent background (public/brand/mark.png, 255×295) — it is shown at 32–48 px, so the drawing stays
 * exact; the favicon is app/icon.png from the same file. The wordmark is text: «Med.uz» navy, «.ai» sky blue.
 */
const MARK_W = 255, MARK_H = 295;
export function BrandMark({ className = 'h-8 w-8', title }: { className?: string; title?: string; compact?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element -- a static brand asset, no optimisation needed
  return <img src="/brand/mark.png" width={MARK_W} height={MARK_H} alt={title ?? ''} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} className={`object-contain ${className}`} draggable={false} />;
}

export const BRAND_NAME = 'Med.uz.ai';

/** Text wordmark: "Med.uz" navy + ".ai" sky blue, as in the logo. */
export function BrandWordmark({ className = 'text-[1.125rem]' }: { className?: string }) {
  return <span className={`font-bold tracking-tight ${className}`}><span className="text-[#00226d]">Med.uz</span><span className="text-[#56abe0]">.ai</span></span>;
}

export function BrandLockup({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2">
      <BrandMark className={size === 'lg' ? 'h-12 w-12' : 'h-8 w-8'} />
      <BrandWordmark className={size === 'lg' ? 'text-[1.5rem]' : 'text-[1.125rem]'} />
    </span>
  );
}
