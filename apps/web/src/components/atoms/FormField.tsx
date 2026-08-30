import type { ReactNode } from 'react';

export function FormField({ label, htmlFor, error, hint, required, children }: { label: string; htmlFor: string; error?: string; hint?: string; required?: boolean; children: ReactNode }) {
  const descriptionId = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  return <div className="space-y-1.5">
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-800">{label}{required && <span className="ml-1 text-red-600" aria-hidden="true">*</span>}</label>
    {children}
    {error ? <p id={descriptionId} role="alert" className="text-sm text-red-700">{error}</p> : hint ? <p id={descriptionId} className="text-sm text-slate-500">{hint}</p> : null}
  </div>;
}

export const fieldClass = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 transition-colors focus:border-brand-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';
