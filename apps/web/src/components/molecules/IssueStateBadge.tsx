import { CircleDot, CircleCheck } from 'lucide-react';
import type { IssueStatus } from '../../lib/types';
export function IssueStateBadge({ status }: { status: IssueStatus }) {
  const presentation = status === 'OPEN'
    ? { label: '开放', Icon: CircleDot, className: 'bg-emerald-100 text-emerald-800' }
    : { label: '已关闭', Icon: CircleCheck, className: 'bg-violet-100 text-violet-800' };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${presentation.className}`}><presentation.Icon className="size-3.5" aria-hidden="true" />{presentation.label}</span>;
}
