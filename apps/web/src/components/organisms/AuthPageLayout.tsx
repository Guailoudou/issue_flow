import { CircleDot } from 'lucide-react';
import type { ReactNode } from 'react';

export function AuthPageLayout({ platformName, platformDescription, title, description, children, footer }: { platformName: string; platformDescription?: string; title: string; description: string; children: ReactNode; footer: ReactNode }) {
  return <main className="grid min-h-screen bg-brand-50 lg:grid-cols-2">
    <section className="hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="flex items-center gap-3 text-xl font-bold"><span className="rounded-xl bg-brand-600 p-2"><CircleDot className="size-7" aria-hidden="true" /></span>{platformName}</div>
      <div className="max-w-xl"><h1 className="text-4xl font-bold leading-tight">把每个问题变成<br />清晰可追踪的进展</h1><p className="mt-5 text-lg text-brand-100">{platformDescription || '在一个专注的空间中创建、分派并完成工作。'}</p></div>
      <p className="text-sm text-brand-200">Issue collaboration, made clear.</p>
    </section>
    <section className="flex items-center justify-center p-5 py-8"><div className="w-full max-w-md">
      <div className="mb-8 lg:hidden"><div className="flex items-center gap-2 text-xl font-bold text-brand-900"><CircleDot className="size-7" aria-hidden="true" />{platformName}</div></div>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-slate-600">{description}</p>
      {children}
      <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>
    </div></section>
  </main>;
}
