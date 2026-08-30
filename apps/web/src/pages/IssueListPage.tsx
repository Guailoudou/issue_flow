import { useQuery } from '@tanstack/react-query';
import { CircleDot, FileDown, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/atoms/Button';
import { Alert } from '../components/atoms/Alert';
import { EmptyState } from '../components/atoms/EmptyState';
import { Spinner } from '../components/atoms/Spinner';
import { ErrorPanel } from '../components/molecules/ErrorPanel';
import { PageHeader } from '../components/molecules/PageHeader';
import { Pagination } from '../components/molecules/Pagination';
import { FilterBar, type Filters } from '../components/organisms/FilterBar';
import { IssueExportDialog } from '../components/organisms/IssueExportDialog';
import { IssueListItem } from '../components/organisms/IssueListItem';
import { useAuth } from '../features/auth/AuthProvider';
import { useIssueMetadata } from '../features/issues/useIssueMetadata';
import { api, queryString } from '../lib/api';
import { normalizeIssuePage } from '../lib/normalize';
import type { Issue, PageResult } from '../lib/types';
const defaults: Filters = { q: '', status: 'OPEN', assignee: '', author: '', label: '', milestone: '', sort: 'updated-desc' };
export const issueListStateQuery = (status: string) => status === 'ALL' ? undefined : status;

export function IssueListPage() {
  const [params, setParams] = useSearchParams(); const { settings, user } = useAuth(); const meta = useIssueMetadata();
  const [exportOpen, setExportOpen] = useState(false); const [exportFeedback, setExportFeedback] = useState<{ message: string; success?: boolean } | null>(null);
  const filters: Filters = { ...defaults, ...Object.fromEntries(params) }; const page = Math.max(1, Number(params.get('page') || 1));
  const [sort, order] = filters.sort.split('-') as ['created' | 'updated', 'asc' | 'desc'];
  const query = useQuery({ queryKey: ['issues', params.toString()], queryFn: async () => normalizeIssuePage(await api<PageResult<Issue>>(`/issues${queryString({ q: filters.q, state: issueListStateQuery(filters.status), authorId: filters.author, assigneeId: filters.assignee, labelId: filters.label, milestoneId: filters.milestone, sort: sort === 'created' ? 'createdAt' : 'updatedAt', order, page, pageSize: settings.defaultPageSize })}`)) });
  const update = useCallback((next: Partial<Filters>) => { setParams((previous) => { const copy = new URLSearchParams(previous); Object.entries(next).forEach(([k, v]) => v ? copy.set(k, v) : copy.delete(k)); copy.delete('page'); return copy; }, { replace: true }); }, [setParams]);
  const canCreate = user?.role === 'ADMIN' || user?.roles?.includes('MANAGEMENT') || settings.allowUserCreateIssue;
  const actions = <><Button variant="secondary" icon={<FileDown className="size-4" aria-hidden="true" />} onClick={() => { setExportFeedback(null); setExportOpen(true); }}>导出表格</Button>{canCreate && <Link to="/issues/new"><Button icon={<Plus className="size-4" aria-hidden="true" />}>新建 Issue</Button></Link>}</>;
  return <div className="page-container"><PageHeader title="Issues" description="跟踪、分派并推进平台中的所有工作" actions={actions} />{exportFeedback && <div className="mb-4"><Alert message={exportFeedback.message} variant={exportFeedback.success ? 'success' : 'error'} /></div>}<section className="surface overflow-hidden"><FilterBar value={filters} users={meta.users} labels={meta.labels} milestones={meta.milestones} onChange={update} onClear={() => setParams({ status: 'OPEN', sort: 'updated-desc' }, { replace: true })} />{query.isPending ? <Spinner label="正在加载 Issues" /> : query.isError ? <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /> : query.data.items.length === 0 ? <EmptyState icon={CircleDot} title="没有找到 Issue" description="调整筛选条件，或创建第一个 Issue 开始协作。" action={canCreate ? <Link to="/issues/new"><Button icon={<Plus className="size-4" />}>新建 Issue</Button></Link> : undefined} /> : <div>{query.data.items.map((issue) => <IssueListItem key={issue.id} issue={issue} />)}</div>}<Pagination page={query.data?.page ?? page} totalPages={query.data?.totalPages ?? 1} onChange={(next) => setParams((previous) => { const copy = new URLSearchParams(previous); copy.set('page', String(next)); return copy; })} /></section><IssueExportDialog open={exportOpen} filters={filters} onClose={() => setExportOpen(false)} onExported={(fileName) => setExportFeedback({ message: `已导出 ${fileName}`, success: true })} /></div>;
}
