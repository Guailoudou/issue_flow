import { CircleCheck, CircleDot, ExternalLink, GitCommitHorizontal, GitMerge, MessageSquare, Paperclip, Pencil, Quote, Tag, UserRoundPlus } from 'lucide-react';
import type { Comment, Label, Milestone, TimelineEvent, User } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { Avatar } from '../atoms/Avatar';
import { Badge } from '../atoms/Badge';
import { MarkdownRenderer } from '../molecules/MarkdownRenderer';

const icons = { COMMENT_CREATED: MessageSquare, COMMENT_EDITED: Pencil, COMMENT_DELETED: MessageSquare, ISSUE_CLOSED: CircleCheck, ISSUE_CLOSED_BY_YUNXIAO_COMMIT: CircleCheck, ISSUE_CLOSED_BY_YUNXIAO_MR: GitMerge, ISSUE_REOPENED: CircleDot, ISSUE_REOPENED_BY_YUNXIAO_COMMIT: CircleDot, ISSUE_EDITED: Pencil, ASSIGNEES_CHANGED: UserRoundPlus, LABELS_CHANGED: Tag, MILESTONE_CHANGED: Tag, ATTACHMENT_ADDED: Paperclip, ATTACHMENT_REMOVED: Paperclip, YUNXIAO_COMMIT_REFERENCED: GitCommitHorizontal, YUNXIAO_MR_REFERENCED: GitMerge };
const fallbackDescriptions: Record<string, string> = { ISSUE_CREATED: '创建了 Issue', COMMENT_CREATED: '发表了评论', COMMENT_EDITED: '编辑了评论', COMMENT_DELETED: '删除了一条评论', ISSUE_CLOSED: '关闭了 Issue', ISSUE_CLOSED_BY_YUNXIAO_COMMIT: '通过云效提交关闭了 Issue', ISSUE_CLOSED_BY_YUNXIAO_MR: '通过云效合并请求关闭了 Issue', ISSUE_REOPENED: '重新打开了 Issue', ISSUE_REOPENED_BY_YUNXIAO_COMMIT: '通过云效提交重新打开了 Issue', ISSUE_EDITED: '更新了 Issue', ASSIGNEES_CHANGED: '更新了负责人', LABELS_CHANGED: '更新了标签', MILESTONE_CHANGED: '更新了里程碑', ATTACHMENT_ADDED: '添加了附件', ATTACHMENT_REMOVED: '删除了附件' };
const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numberIds = (value: unknown) => Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number' && Number.isInteger(id)) : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';
// ponytail: removed metadata falls back to stable IDs; persist snapshots if deleted names must remain readable.
const named = (value: unknown, names: Map<number, string>, fallback: string) => numberIds(value).map((id) => names.get(id) ?? `${fallback} #${id}`).join('、');

function eventDescription(event: TimelineEvent, users: Map<number, string>, milestones: Map<number, string>) {
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

function LabelChangeEvent({ event, labels }: { event: TimelineEvent; labels: Map<number, Label> }) {
  const data = asRecord(event.data ?? event.metadata);
  const changes = [['添加标签', numberIds(data.added)], ['移除标签', numberIds(data.removed)]] as const;
  return <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-600"><Tag className="size-4 shrink-0 text-brand-700" aria-hidden="true" /><strong className="text-slate-900">{event.actor.displayName}</strong>{data.source === 'YUNXIAO' && <span>通过云效提交</span>}{changes.map(([verb, ids]) => ids.length > 0 && <span key={verb} className="inline-flex flex-wrap items-center gap-1.5"><span>{verb}</span>{ids.map((id) => { const label = labels.get(id); return label ? <Badge key={id} color={label.color}>{label.name}</Badge> : <span key={id}>标签 #{id}</span>; })}</span>)}<span aria-hidden="true">·</span><time className="text-xs text-slate-500" dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></p>;
}

function CodeReferenceEvent({ event }: { event: TimelineEvent }) {
  const data = asRecord(event.data);
  const isCommit = event.type === 'YUNXIAO_COMMIT_REFERENCED';
  const title = text(data.title);
  const url = text(data.url);
  const source = text(data.sourceBranch);
  const target = text(data.targetBranch);
  const sha = text(data.commitSha);
  const status = text(data.status);
  const Icon = isCommit ? GitCommitHorizontal : GitMerge;
  return <div className="min-w-0 flex-1 py-1.5"><p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-600"><Icon className="size-4 shrink-0 text-brand-700" aria-hidden="true" /><strong className="text-slate-900">{event.actor.displayName}</strong><span>关联了云效{isCommit ? '提交' : '合并请求'}</span>{url ? <a className="inline-flex min-w-0 items-start gap-1 break-words font-medium text-brand-700 underline-offset-2 hover:underline" href={url} target="_blank" rel="noreferrer"><span>{title}</span><ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span className="sr-only">（在新窗口打开）</span></a> : <strong className="break-words text-slate-800">{title}</strong>}{status && <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">{status}</span>}<span aria-hidden="true">·</span><time className="text-xs text-slate-500" dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></p>{(source || sha) && <p className="mt-1 flex flex-wrap gap-3 pl-5 text-xs text-slate-500">{source && <span className="break-words font-mono">{source}{target ? ` → ${target}` : ''}</span>}{sha && <code title={sha}>{sha.slice(0, 8)}</code>}</p>}</div>;
}

export function Timeline({ events, users = [], labels = [], milestones = [], onQuoteComment }: { events: TimelineEvent[]; users?: User[]; labels?: Label[]; milestones?: Milestone[]; onQuoteComment?: (comment: Comment, body: string) => void }) {
  const userNames = new Map(users.map((user) => [user.id, user.displayName]));
  const labelById = new Map(labels.map((label) => [label.id, label]));
  const milestoneNames = new Map(milestones.map((milestone) => [milestone.id, milestone.title]));
  return <ol className="space-y-4" aria-label="Issue 时间线">{events.map((event) => { const Icon = icons[event.type as keyof typeof icons] ?? CircleDot; const comment = event.comment; const codeReference = event.type === 'YUNXIAO_COMMIT_REFERENCED' || event.type === 'YUNXIAO_MR_REFERENCED'; return <li key={`${event.type}-${event.id}`} className="relative flex gap-3"><div className="absolute bottom-[-1rem] left-[17px] top-9 w-px bg-slate-200 last:hidden" /><Avatar name={event.actor.displayName} src={event.actor.avatarUrl} />{codeReference ? <CodeReferenceEvent event={event} /> : <div className={`min-w-0 flex-1 ${comment ? 'surface overflow-hidden' : 'py-1.5'}`}>{comment ? <><div className="flex min-h-11 items-center border-b bg-slate-50 pl-4 text-sm"><div className="min-w-0 flex-1"><strong>{event.actor.displayName}</strong> 评论于 <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>{comment.updatedAt && comment.updatedAt !== comment.createdAt && <span className="ml-2 text-xs text-slate-500">已编辑</span>}</div>{onQuoteComment && <button type="button" className="flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600/25" aria-label={`引用回复 ${event.actor.displayName} 的评论`} onClick={(click) => { const container = click.currentTarget.closest('.surface')?.querySelector('.comment-markdown'); const selection = window.getSelection(); const selected = selection && container?.contains(selection.anchorNode) && container.contains(selection.focusNode) ? selection.toString().trim() : ''; onQuoteComment(comment, selected || comment.body); }}><Quote className="size-4" aria-hidden="true" />引用回复</button>}</div><div className="comment-markdown p-4"><MarkdownRenderer value={comment.body} emptyText="评论已删除" /></div></> : event.type === 'LABELS_CHANGED' ? <LabelChangeEvent event={event} labels={labelById} /> : <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-600"><Icon className="size-4 shrink-0 text-brand-700" aria-hidden="true" /><strong className="text-slate-900">{event.actor.displayName}</strong><span className="break-words text-slate-700">{eventDescription(event, userNames, milestoneNames)}</span><span aria-hidden="true">·</span><time className="text-xs text-slate-500" dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></p>}</div>}</li>; })}</ol>;
}
