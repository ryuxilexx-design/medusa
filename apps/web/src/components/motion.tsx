'use client';
import { useEffect } from 'react';

/**
 * «Prujina» press feedback for every button and link (chosen 2026-10-22, docs/UI_GUIDE.md §0): on pointer-down the
 * element shrinks at once, on release it springs back with a small overshoot — even the quickest tap shows the whole
 * bounce. Web Animations instead of classes: a re-render (the button becoming «active») would wipe a class, an
 * animation survives it. One document listener; off under prefers-reduced-motion. Elements that are positioned with
 * their own transform (or inside data-no-press) are left alone.
 */
const TARGET = 'button:not(:disabled), a[href], [role="button"], [role="tab"], summary';
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export function PressMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof Element.prototype.animate !== 'function') return;
    let pressed: { el: HTMLElement; down: Animation } | null = null;
    const release = () => {
      const cur = pressed; pressed = null;
      if (!cur) return;
      cur.down.cancel();
      cur.el.animate([{ transform: 'scale(0.94)' }, { transform: 'scale(1)' }], { duration: 450, easing: SPRING });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const el = (e.target as Element | null)?.closest?.(TARGET) as HTMLElement | null;
      if (!el || el.closest('[data-no-press]')) return;
      if (getComputedStyle(el).transform !== 'none' && !el.getAnimations().length) return;
      if (pressed) release();
      for (const a of el.getAnimations()) a.cancel();
      pressed = { el, down: el.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.94)' }], { duration: 80, easing: 'ease-out', fill: 'forwards' }) };
    };
    document.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('blur', release);
    return () => { document.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); window.removeEventListener('blur', release); };
  }, []);
  return null;
}
