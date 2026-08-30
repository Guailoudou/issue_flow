import { AlertCircle, CheckCircle2 } from 'lucide-react';
export function Alert({ message, variant = 'error' }: { message: string; variant?: 'error' | 'success' }) {
  const Icon = variant === 'error' ? AlertCircle : CheckCircle2;
  return <div role={variant === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${variant === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{message}</div>;
}
