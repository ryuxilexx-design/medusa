/**
 * Med.uz.ai brand (2026-10-22 artwork, docs/brand/meduzai-logo-2026-10-22.png): the jellyfish mark is the original
 * raster with a transparent background (public/brand/mark.png, 255×295) — it is shown at 32–48 px, so the drawing stays
 * exact; the favicon is app/icon.png from the same file. The wordmark is text: «Med.uz» navy, «.ai» sky blue.
 */
const MARK_W = 255, MARK_H = 295;
export function BrandMark({ className = 'h-8 w-8', title, tile = false }: { className?: string; title?: string; compact?: boolean; tile?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element -- a static brand asset, no optimisation needed
  const img = <img src="/brand/mark.png" width={MARK_W} height={MARK_H} alt={title ?? ''} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} className={tile ? 'h-[78%] w-[78%] object-contain' : `object-contain ${className}`} draggable={false} />;
  // on glass (sidebar, login card) the light-blue mark needs a white tile behind it, like an app icon; on paper it stands alone
  return tile ? <span className={`inline-flex shrink-0 items-center justify-center rounded-[28%] bg-white shadow-[0_1px_2px_rgba(10,30,70,0.12),0_6px_16px_-8px_rgba(10,30,70,0.35)] ${className}`}>{img}</span> : img;
}

export const BRAND_NAME = 'Med.uz.ai';

/** Text wordmark: "Med.uz" navy + ".ai" sky blue, as in the logo. */
export function BrandWordmark({ className = 'text-[1.125rem]' }: { className?: string }) {
  return <span className={`font-bold tracking-tight ${className}`}><span className="text-[#00226d]">Med.uz</span><span className="text-[#2f86cf]">.ai</span></span>;
}

export function BrandLockup({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2">
      <BrandMark tile className={size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'} />
      <BrandWordmark className={size === 'lg' ? 'text-[1.5rem]' : 'text-[1.1875rem]'} />
    </span>
  );
}
