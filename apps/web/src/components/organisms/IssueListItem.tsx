import { MessageSquare, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Issue } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { Avatar } from '../atoms/Avatar';
import { Badge } from '../atoms/Badge';
import { IssueStateBadge } from '../molecules/IssueStateBadge';
export function IssueListItem({ issue }: { issue: Issue }) {
  return <article className="group border-b p-4 transition-colors last:border-b-0 hover:bg-brand-50/50"><div className="flex items-start gap-3"><IssueStateBadge status={issue.status} /><div className="min-w-0 flex-1"><Link to={`/issues/${issue.number}`} className="font-semibold text-slate-950 hover:text-brand-700 hover:underline">{issue.title}</Link><div className="mt-2 flex flex-wrap gap-1.5">{issue.labels.map((label) => <Badge key={label.id} color={label.color}>{label.name}</Badge>)}</div><p className="mt-2 text-xs text-slate-500">#{issue.number} 由 {issue.author.displayName} 创建 · 更新于 {formatDate(issue.updatedAt)}</p></div><div className="hidden shrink-0 items-center gap-4 text-xs text-slate-500 sm:flex">{issue.assignees.length > 0 && <span className="flex -space-x-1" aria-label={`${issue.assignees.length} 位负责人`}>{issue.assignees.slice(0, 3).map((user) => <Avatar key={user.id} name={user.displayName} src={user.avatarUrl} size="sm" />)}</span>}<span className="flex items-center gap-1" title="评论数"><MessageSquare className="size-4" />{issue.commentsCount ?? 0}</span>{issue.assignees.length > 3 && <span className="sr-only"><Users />更多负责人</span>}</div></div></article>;
}
