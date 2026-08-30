import { Search, Tag } from 'lucide-react';
import { useState } from 'react';
import type { Label } from '../../lib/types';
import { Badge } from '../atoms/Badge';
import { Checkbox } from '../atoms/Checkbox';
import { Input } from '../atoms/Input';

export function LabelFilter({ labels, value, onChange }: { labels: Label[]; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState('');
  const selected = value.split(',').filter(Boolean);
  const visible = labels.filter((label) => `${label.name} ${label.description ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const toggle = (id: number, checked: boolean) => onChange((checked ? [...selected, String(id)] : selected.filter((value) => value !== String(id))).join(','));
  return <details className="relative">
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 transition-colors hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/25"><Tag className="size-4" aria-hidden="true" />标签{selected.length ? ` · ${selected.length}` : ''}</summary>
    <div className="absolute right-0 z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border bg-white p-2 shadow-lg">
      <div className="relative mb-2"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="搜索标签" aria-label="搜索标签" /></div>
      <div className="max-h-64 space-y-1 overflow-auto" role="group" aria-label="按标签筛选">{visible.map((label) => <label key={label.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 transition-colors hover:bg-slate-50"><Checkbox checked={selected.includes(String(label.id))} onChange={(event) => toggle(label.id, event.target.checked)} /><span className="min-w-0 flex-1"><Badge color={label.color}>{label.name}</Badge>{label.description && <span className="mt-0.5 block truncate text-xs text-slate-500" title={label.description}>{label.description}</span>}</span></label>)}{visible.length === 0 && <p className="px-2 py-4 text-center text-sm text-slate-500">没有匹配的标签</p>}</div>
    </div>
  </details>;
}
