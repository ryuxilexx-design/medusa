/**
 * The lens of the Liquid Glass material: an SVG displacement filter the `.glass` class points at (globals.css).
 * It bends the wallpaper behind a panel the way thick glass does; browsers without backdrop-filter: url() just blur.
 * Rendered once, in the root layout.
 */
export function GlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="lg-lens" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="7" result="n" />
        <feGaussianBlur in="n" stdDeviation="2" result="nb" />
        <feDisplacementMap in="SourceGraphic" in2="nb" scale="30" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
