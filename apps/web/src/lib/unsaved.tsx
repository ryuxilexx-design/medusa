'use client';
import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal } from '@/components/ui';

// Registry of screens that currently hold unsaved input. Kept outside React so link clicks can consult it synchronously.
const dirty = new Set<string>();
let ask: ((go: () => void) => void) | null = null;

/** Marks the calling screen as holding unsaved changes: reload/close shows the browser prompt, in-app links show a confirm dialog. */
export function useUnsavedGuard(isDirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (!isDirty) { dirty.delete(id); return; }
    dirty.add(id);
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => { dirty.delete(id); window.removeEventListener('beforeunload', onUnload); };
  }, [isDirty, id]);
}

/** Runs `go` immediately, or after the user confirms leaving unsaved changes. */
export function confirmLeave(go: () => void) {
  if (!dirty.size || !ask) return go();
  ask(go);
}

/** Mounted once in the app shell: intercepts internal link clicks while some screen is dirty. */
export function NavigationGuard() {
  const router = useRouter();
  const [pending, setPending] = useState<null | (() => void)>(null);
  useEffect(() => {
    ask = (go) => setPending(() => go);
    const onClick = (e: MouseEvent) => {
      if (!dirty.size || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      e.preventDefault(); e.stopPropagation();
      setPending(() => () => router.push(url.pathname + url.search));
    };
    document.addEventListener('click', onClick, true);
    return () => { document.removeEventListener('click', onClick, true); ask = null; };
  }, [router]);
  return (
    <Modal open={!!pending} onClose={() => setPending(null)} title="Saqlanmagan o‘zgarishlar bor"
      footer={<><Button variant="primary" onClick={() => setPending(null)}>Sahifada qolish</Button>
        <Button variant="danger" onClick={() => { const go = pending; dirty.clear(); setPending(null); go?.(); }}>Saqlamasdan chiqish</Button></>}>
      <p className="text-sm text-slate-700">Bu sahifada saqlanmagan matn bor. Chiqsangiz, u o‘chadi. Avval «Qoralamani saqlash» ni bosing yoki sahifada qoling.</p>
    </Modal>
  );
}
