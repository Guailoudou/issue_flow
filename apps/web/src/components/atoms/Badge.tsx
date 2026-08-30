import type { ReactNode } from 'react';
export function Badge({ children, color, className = '' }: { children: ReactNode; color?: string; className?: string }) {
  return <span className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${className}`} style={color ? { backgroundColor: `#${color.replace('#', '')}20`, borderColor: `#${color.replace('#', '')}`, color: '#0f172a' } : undefined}>{children}</span>;
}
