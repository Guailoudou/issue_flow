import { Bell, BellOff, CalendarClock, Pencil, Tag, Users } from 'lucide-react';
import type { Issue } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { Avatar } from '../atoms/Avatar';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';

export function IssueSidebar({
  issue,
  onEditRelations,
  onToggleSubscribe,
  subscribing,
}: {
  issue: Issue;
  onEditRelations?: () => void;
  onToggleSubscribe: () => void;
  subscribing?: boolean;
}) {
  return (
    <aside className="surface divide-y">
      <section className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4" aria-hidden="true" />负责人</h2>
          {onEditRelations && <Button variant="ghost" icon={<Pencil className="size-4" aria-hidden="true" />} onClick={onEditRelations}>编辑</Button>}
        </div>
        <div className="space-y-3">{([['产品', issue.productOwners], ['开发', issue.developerOwners]] as const).map(([label, users]) => <div key={label}><p className="mb-1 text-xs font-medium text-slate-500">{label}负责人</p>{users.length ? <div className="space-y-1">{users.map((user) => <div key={user.id} className="flex items-center gap-2"><Avatar name={user.displayName} src={user.avatarUrl} size="sm" /><span className="text-sm">{user.displayName}</span></div>)}</div> : <p className="text-sm text-slate-400">未指派</p>}</div>)}</div>
      </section>
      <section className="p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Tag className="size-4" aria-hidden="true" />标签</h2>
        {issue.labels.length ? <div className="flex flex-wrap gap-1.5">{issue.labels.map((label) => <Badge key={label.id} color={label.color}>{label.name}</Badge>)}</div> : <p className="text-sm text-slate-500">暂无标签</p>}
      </section>
      <section className="p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" aria-hidden="true" />里程碑</h2>
        <p className="text-sm text-slate-600">{issue.milestone?.title ?? '无里程碑'}</p>
        {issue.milestone?.dueDate && <p className="mt-1 text-xs text-slate-500">截止 {formatDate(issue.milestone.dueDate)}</p>}
      </section>
      <section className="p-4">
        <Button className="w-full" variant="secondary" loading={subscribing} icon={issue.subscribed ? <BellOff className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />} onClick={onToggleSubscribe}>{issue.subscribed ? '取消订阅' : '订阅更新'}</Button>
      </section>
    </aside>
  );
}
