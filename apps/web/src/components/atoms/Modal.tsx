import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="modal-title" className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 id="modal-title" className="text-lg font-semibold">{title}</h2><button onClick={onClose} aria-label="关闭对话框" className="flex size-11 items-center justify-center rounded-lg hover:bg-slate-100"><X className="size-5" /></button></div>{children}</div></div>;
}
