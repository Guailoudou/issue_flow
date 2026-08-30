import { Search } from 'lucide-react';
import { useState } from 'react';
import type { Label } from '../../lib/types';
import { Checkbox } from '../atoms/Checkbox';
import { Badge } from '../atoms/Badge';
import { Input } from '../atoms/Input';
export function LabelPicker({ labels, value, onChange }: { labels: Label[]; value: number[]; onChange: (ids: number[]) => void }) {
  const [search, setSearch] = useState('');
  if (!labels.length) return <p className="text-sm text-slate-500">暂无标签</p>;
  const visible = labels.filter((label) => `${label.name} ${label.description ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div><div className="relative mb-2"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="搜索标签" aria-label="搜索可选标签" /></div><div className="max-h-52 space-y-1 overflow-auto" role="group" aria-label="选择标签">{visible.map((label) => <label key={label.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 transition-colors hover:bg-slate-50"><Checkbox checked={value.includes(label.id)} onChange={(e) => onChange(e.target.checked ? [...value, label.id] : value.filter((id) => id !== label.id))} /><span className="min-w-0 flex-1"><Badge color={label.color}>{label.name}</Badge>{label.description && <span className="mt-0.5 block truncate text-xs text-slate-500" title={label.description}>{label.description}</span>}</span></label>)}{visible.length === 0 && <p className="px-2 py-4 text-center text-sm text-slate-500">没有匹配的标签</p>}</div></div>;
}
