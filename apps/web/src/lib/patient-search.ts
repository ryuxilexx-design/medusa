'use client';
import { useEffect } from 'react';

// Hand-off of the top-bar search text to the patient list. A patient's name is personal data, so it never goes into the
// URL (history, proxy logs) or into browser storage: it lives in memory only, for the one navigation.
let pending: string | null = null;
const listeners = new Set<(q: string) => void>();

/** Called by the top-bar search: an open patient list takes it at once, otherwise the next one to mount does. */
export function handPatientSearch(q: string) {
  if (listeners.size) listeners.forEach((l) => l(q));
  else pending = q;
}

/** The text handed over before the patient list mounted (taken once). */
export function takePatientSearch(): string | null {
  const q = pending;
  pending = null;
  return q;
}

/** Lets an open patient list receive later searches from the top bar. */
export function usePatientSearchListener(set: (q: string) => void) {
  useEffect(() => {
    listeners.add(set);
    return () => { listeners.delete(set); };
  }, [set]);
}
