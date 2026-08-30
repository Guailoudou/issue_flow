import { LoaderCircle } from 'lucide-react';
export function Spinner({ label = '加载中' }: { label?: string }) { return <div className="flex min-h-40 items-center justify-center gap-2 text-slate-600" role="status"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" /><span>{label}</span></div>; }
