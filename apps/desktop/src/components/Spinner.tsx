import { LoaderCircle } from 'lucide-react';

export function Spinner({ label = '正在加载…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 p-6 text-slate-500 ${className}`} role="status">
      <LoaderCircle className="size-6 animate-spin text-brand-600" aria-hidden="true" />
      <span className="text-xs">{label}</span>
    </div>
  );
}
