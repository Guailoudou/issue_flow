import { useQuery } from '@tanstack/react-query';
import { ExternalLink, GitCommitHorizontal, GitMerge, RefreshCw } from 'lucide-react';
import { Alert } from '../atoms/Alert';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { CodeReference } from '../../lib/types';

function referenceLabel(type: CodeReference['type']) {
  return type === 'COMMIT' ? '提交' : '合并请求';
}

function ReferenceIcon({ type }: { type: CodeReference['type'] }) {
  const Icon = type === 'COMMIT' ? GitCommitHorizontal : GitMerge;
  return <span className="rounded-full bg-brand-50 p-2 text-brand-700"><Icon className="size-4" aria-hidden="true" /></span>;
}

export function DevelopmentActivity({ issueId }: { issueId: string | number }) {
  const query = useQuery({
    queryKey: ['issue-code-references', String(issueId)],
    queryFn: () => api<{ references: CodeReference[] }>(`/issues/${issueId}/code-references`),
  });

  return <section className="surface overflow-hidden" aria-labelledby="development-activity-heading">
    <header className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
      <div>
        <h2 id="development-activity-heading" className="font-semibold">开发动态</h2>
        <p className="mt-0.5 text-xs text-slate-500">来自云效 Codeup 的提交与合并请求</p>
      </div>
      {query.isFetching && !query.isPending && <Spinner label="正在刷新开发动态" />}
    </header>
    <div className="p-4">
      {query.isPending ? <div className="flex min-h-24 items-center justify-center"><Spinner label="正在加载开发动态" /></div> : query.isError ? <div className="space-y-3"><Alert message={query.error.message} /><Button type="button" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void query.refetch()}>重新加载</Button></div> : query.data.references.length === 0 ? <p className="py-5 text-center text-sm text-slate-500">暂无关联提交或合并请求</p> : <ul className="divide-y" aria-label="代码关联列表">{query.data.references.map((reference) => <li key={reference.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
        <ReferenceIcon type={reference.type} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-slate-200 bg-slate-50 text-slate-700">{referenceLabel(reference.type)}</Badge>
            {reference.status && <Badge className="border-brand-200 bg-brand-50 text-brand-800">{reference.status}</Badge>}
          </div>
          <div className="mt-2 min-w-0">
            {reference.url ? <a className="inline-flex max-w-full items-start gap-1 break-words font-medium text-brand-700 [overflow-wrap:anywhere] underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600" href={reference.url} target="_blank" rel="noreferrer"><span>{reference.title}</span><ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span className="sr-only">（在新窗口打开）</span></a> : <p className="break-words font-medium">{reference.title}</p>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            {reference.sourceBranch && <span className="break-words font-mono [overflow-wrap:anywhere]">{reference.sourceBranch}{reference.targetBranch ? ` → ${reference.targetBranch}` : ''}</span>}
            {reference.authorName && <span>{reference.authorName}</span>}
            {reference.commitSha && <code title={reference.commitSha}>{reference.commitSha.slice(0, 8)}</code>}
            <time dateTime={reference.updatedAt}>{formatDate(reference.updatedAt)}</time>
          </div>
        </div>
      </li>)}</ul>}
    </div>
  </section>;
}
