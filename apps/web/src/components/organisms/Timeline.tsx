import { CircleCheck, CircleDot, GitMerge, MessageSquare, Paperclip, Pencil, Tag, UserRoundPlus } from 'lucide-react';
import type { Label, Milestone, TimelineEvent, User } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { Avatar } from '../atoms/Avatar';
import { MarkdownRenderer } from '../molecules/MarkdownRenderer';

const icons = { COMMENT_CREATED: MessageSquare, COMMENT_EDITED: Pencil, COMMENT_DELETED: MessageSquare, ISSUE_CLOSED: CircleCheck, ISSUE_CLOSED_BY_YUNXIAO_COMMIT: CircleCheck, ISSUE_CLOSED_BY_YUNXIAO_MR: GitMerge, ISSUE_REOPENED: CircleDot, ISSUE_REOPENED_BY_YUNXIAO_COMMIT: CircleDot, ISSUE_EDITED: Pencil, ASSIGNEES_CHANGED: UserRoundPlus, LABELS_CHANGED: Tag, MILESTONE_CHANGED: Tag, ATTACHMENT_ADDED: Paperclip, ATTACHMENT_REMOVED: Paperclip };
const fallbackDescriptions: Record<string, string> = { ISSUE_CREATED: '创建了 Issue', COMMENT_CREATED: '发表了评论', COMMENT_EDITED: '编辑了评论', COMMENT_DELETED: '删除了一条评论', ISSUE_CLOSED: '关闭了 Issue', ISSUE_CLOSED_BY_YUNXIAO_COMMIT: '通过云效提交关闭了 Issue', ISSUE_CLOSED_BY_YUNXIAO_MR: '通过云效合并请求关闭了 Issue', ISSUE_REOPENED: '重新打开了 Issue', ISSUE_REOPENED_BY_YUNXIAO_COMMIT: '通过云效提交重新打开了 Issue', ISSUE_EDITED: '更新了 Issue', ASSIGNEES_CHANGED: '更新了负责人', LABELS_CHANGED: '更新了标签', MILESTONE_CHANGED: '更新了里程碑', ATTACHMENT_ADDED: '添加了附件', ATTACHMENT_REMOVED: '删除了附件' };
const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numberIds = (value: unknown) => Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number' && Number.isInteger(id)) : [];
// ponytail: removed metadata falls back to stable IDs; persist snapshots if deleted names must remain readable.
const named = (value: unknown, names: Map<number, string>, fallback: string) => numberIds(value).map((id) => names.get(id) ?? `${fallback} #${id}`).join('、');

function eventDescription(event: TimelineEvent, users: Map<number, string>, labels: Map<number, string>, milestones: Map<number, string>) {
  const data = asRecord(event.data ?? event.metadata);
  if (event.type === 'ISSUE_EDITED') {
    const title = asRecord(data.title);
    const titleChange = typeof title.from === 'string' && typeof title.to === 'string' ? `将标题从“${title.from}”改为“${title.to}”` : data.titleChanged ? '修改了标题' : '';
    return [titleChange, data.bodyChanged ? '修改了描述' : ''].filter(Boolean).join('，并') || fallbackDescriptions[event.type];
  }
  if (event.type === 'ASSIGNEES_CHANGED') {
    const changes: string[] = [];
    for (const [key, role] of [['product', '产品负责人'], ['development', '开发负责人']] as const) {
      const change = asRecord(data[key]);
      if (numberIds(change.added).length) changes.push(`添加${role} ${named(change.added, users, '用户')}`);
      if (numberIds(change.removed).length) changes.push(`移除${role} ${named(change.removed, users, '用户')}`);
    }
    return changes.join('；') || fallbackDescriptions[event.type];
  }
  if (event.type === 'LABELS_CHANGED') {
    const changes = [
      numberIds(data.added).length ? `添加标签 ${named(data.added, labels, '标签')}` : '',
      numberIds(data.removed).length ? `移除标签 ${named(data.removed, labels, '标签')}` : '',
    ].filter(Boolean).join('；');
    return `${data.source === 'YUNXIAO' ? '通过云效提交' : ''}${changes || fallbackDescriptions[event.type]}`;
  }
  if (event.type === 'MILESTONE_CHANGED') {
    const from = typeof data.from === 'number' ? milestones.get(data.from) ?? `里程碑 #${data.from}` : '';
    const to = typeof data.to === 'number' ? milestones.get(data.to) ?? `里程碑 #${data.to}` : '';
    return from && to ? `将里程碑从“${from}”改为“${to}”` : to ? `设置里程碑“${to}”` : from ? `移除里程碑“${from}”` : fallbackDescriptions[event.type];
  }
  if (event.type === 'ATTACHMENT_ADDED' || event.type === 'ATTACHMENT_REMOVED') {
    const fileName = typeof data.fileName === 'string' ? `“${data.fileName}”` : '';
    return `${event.type === 'ATTACHMENT_ADDED' ? '添加' : '删除'}了附件${fileName}`;
  }
  if (['ISSUE_CLOSED_BY_YUNXIAO_COMMIT', 'ISSUE_REOPENED_BY_YUNXIAO_COMMIT', 'ISSUE_CLOSED_BY_YUNXIAO_MR'].includes(event.type)) {
    const sourceTitle = typeof data.title === 'string' ? `“${data.title}”` : '';
    return `${fallbackDescriptions[event.type]}${sourceTitle ? `：${sourceTitle}` : ''}`;
  }
  return fallbackDescriptions[event.type] ?? '更新了 Issue';
}

export function Timeline({ events, users = [], labels = [], milestones = [] }: { events: TimelineEvent[]; users?: User[]; labels?: Label[]; milestones?: Milestone[] }) {
  const userNames = new Map(users.map((user) => [user.id, user.displayName]));
  const labelNames = new Map(labels.map((label) => [label.id, label.name]));
  const milestoneNames = new Map(milestones.map((milestone) => [milestone.id, milestone.title]));
  return <ol className="space-y-4" aria-label="Issue 时间线">{events.map((event) => { const Icon = icons[event.type as keyof typeof icons] ?? CircleDot; const comment = event.comment; return <li key={event.id} className="relative flex gap-3"><div className="absolute bottom-[-1rem] left-[17px] top-9 w-px bg-slate-200 last:hidden" /><Avatar name={event.actor.displayName} src={event.actor.avatarUrl} /><div className={`min-w-0 flex-1 ${comment ? 'surface overflow-hidden' : 'py-1.5'}`}>{comment ? <><div className="border-b bg-slate-50 px-4 py-2 text-sm"><strong>{event.actor.displayName}</strong> 评论于 <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>{comment.updatedAt && comment.updatedAt !== comment.createdAt && <span className="ml-2 text-xs text-slate-500">已编辑</span>}</div><div className="comment-markdown p-4"><MarkdownRenderer value={comment.body} emptyText="评论已删除" /></div></> : <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-600"><Icon className="size-4 shrink-0 text-brand-700" aria-hidden="true" /><strong className="text-slate-900">{event.actor.displayName}</strong><span className="break-words text-slate-700">{eventDescription(event, userNames, labelNames, milestoneNames)}</span><span aria-hidden="true">·</span><time className="text-xs text-slate-500" dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></p>}</div></li>; })}</ol>;
}
