import type { Label } from '../../lib/types';
import { Checkbox } from '../atoms/Checkbox';
import { Badge } from '../atoms/Badge';
export function LabelPicker({ labels, value, onChange }: { labels: Label[]; value: number[]; onChange: (ids: number[]) => void }) {
  if (!labels.length) return <p className="text-sm text-slate-500">暂无标签</p>;
  return <div className="max-h-52 space-y-1 overflow-auto" role="group" aria-label="选择标签">{labels.map((label) => <label key={label.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-slate-50"><Checkbox checked={value.includes(label.id)} onChange={(e) => onChange(e.target.checked ? [...value, label.id] : value.filter((id) => id !== label.id))} /><Badge color={label.color}>{label.name}</Badge></label>)}</div>;
}
