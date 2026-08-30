import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleDot, MessageSquare, UserCheck, Users } from 'lucide-react';
import { Spinner } from '../../components/atoms/Spinner';
import { AppVersion, type BackendVersion } from '../../components/molecules/AppVersion';
import { ErrorPanel } from '../../components/molecules/ErrorPanel';
import { PageHeader } from '../../components/molecules/PageHeader';
import { Timeline } from '../../components/organisms/Timeline';
import { api } from '../../lib/api';
import type { DashboardStats } from '../../lib/types';
export function AdminDashboardPage() {
  const query = useQuery({ queryKey: ['admin-stats'], queryFn: async () => { const raw = await api<{ users: number; activeUsers: number; openIssues: number; closedIssues: number; recentIssues: number; recentComments: number; activity: DashboardStats['recentActivity'] }>('/admin/stats'); return { totalUsers: raw.users, activeUsers: raw.activeUsers, openIssues: raw.openIssues, closedIssues: raw.closedIssues, issuesLast7Days: raw.recentIssues, commentsLast7Days: raw.recentComments, recentActivity: raw.activity } satisfies DashboardStats; } });
  const versionQuery = useQuery({ queryKey: ['backend-version'], queryFn: () => api<BackendVersion>('/version'), staleTime: Infinity });
  const s = query.data; const cards = s ? [{ label: '用户总数', value: s.totalUsers, icon: Users }, { label: '启用用户', value: s.activeUsers, icon: UserCheck }, { label: '开放 Issue', value: s.openIssues, icon: CircleDot }, { label: '已关闭 Issue', value: s.closedIssues, icon: CircleCheck }, { label: '近 7 天新增', value: s.issuesLast7Days, icon: CircleDot }, { label: '近 7 天评论', value: s.commentsLast7Days, icon: MessageSquare }] : [];
  const recentActivity = s?.recentActivity ?? [];
  return <><PageHeader title="平台概览" description="平台运行和协作活动摘要" /><AppVersion backend={versionQuery.data} backendLoading={versionQuery.isPending} backendError={versionQuery.isError} />{query.isPending ? <div className="surface"><Spinner label="正在加载平台统计" /></div> : query.isError ? <div className="surface"><ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /></div> : <><div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{cards.map(({ label, value, icon: Icon }) => <div key={label} className="surface p-4"><div className="flex items-center gap-2 text-sm text-slate-600"><Icon className="size-4 text-brand-700" aria-hidden="true" />{label}</div><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div><section className="surface mt-5 p-4"><h2 className="mb-4 font-semibold">最近活动</h2>{recentActivity.length ? <Timeline events={recentActivity} /> : <p className="text-sm text-slate-500">暂无活动</p>}</section></>}</>;
}
