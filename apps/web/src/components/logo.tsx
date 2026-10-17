export function MeduzaMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0f7872" />
      <path d="M8 15.5c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M10.5 16v5.5M14.2 16v8M17.8 16v8M21.5 16v5.5" stroke="#97e3d9" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
export function MeduzaWordmark() {
  return <span className="flex items-center gap-2"><MeduzaMark /><span className="text-[17px] font-semibold tracking-tight text-slate-900">Meduza</span></span>;
}
