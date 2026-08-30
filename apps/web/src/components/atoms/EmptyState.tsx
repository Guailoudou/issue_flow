import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center"><span className="mb-4 rounded-full bg-brand-50 p-3 text-brand-700"><Icon className="size-7" aria-hidden="true" /></span><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 max-w-md text-sm text-slate-600">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
