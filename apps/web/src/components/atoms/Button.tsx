import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; loading?: boolean; icon?: ReactNode }
const styles: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 border-transparent',
  secondary: 'border-brand-600 bg-white text-brand-700 hover:bg-brand-50',
  ghost: 'border-transparent bg-transparent text-slate-700 hover:bg-slate-100',
  danger: 'border-red-600 bg-red-600 text-white hover:bg-red-700',
};
export function Button({ variant = 'primary', loading, icon, className = '', children, disabled, ...props }: ButtonProps) {
  return <button className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-55 ${styles[variant]} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : icon}{children}
  </button>;
}
