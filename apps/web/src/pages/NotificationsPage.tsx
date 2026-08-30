import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/atoms/Button';
import { EmptyState } from '../components/atoms/EmptyState';
import { Spinner } from '../components/atoms/Spinner';
import { ErrorPanel } from '../components/molecules/ErrorPanel';
import { PageHeader } from '../components/molecules/PageHeader';
import { Pagination } from '../components/molecules/Pagination';
import { NotificationItem } from '../components/organisms/NotificationItem';
import { api, queryString } from '../lib/api';
import type { Notification, PageResult } from '../lib/types';
export function NotificationsPage() { const [params, setParams] = useSearchParams(); const page = Number(params.get('page') || 1); const client = useQueryClient(); const query = useQuery({ queryKey: ['notifications', page], queryFn: () => api<PageResult<Notification>>(`/notifications${queryString({ page, pageSize: 20 })}`) }); const refresh = () => { void client.invalidateQueries({ queryKey: ['notifications'] }); void client.invalidateQueries({ queryKey: ['notifications-unread'] }); }; const mark = useMutation({ mutationFn: (id: number) => api(`/notifications/${id}/read`, { method: 'PATCH' }), onSuccess: refresh }); const all = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh }); const hasUnread = query.data?.items.some((n) => !n.readAt); return <div className="page-container"><PageHeader title="通知" description="与你负责和订阅的 Issue 相关的动态" actions={hasUnread ? <Button variant="secondary" icon={<CheckCheck className="size-4" />} loading={all.isPending} onClick={() => all.mutate()}>全部标为已读</Button> : undefined} /><section className="surface overflow-hidden">{query.isPending ? <Spinner /> : query.isError ? <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /> : query.data.items.length === 0 ? <EmptyState icon={Bell} title="暂无通知" description="当 Issue 有新评论、状态或负责人发生变化时，通知会显示在这里。" /> : query.data.items.map((item) => <NotificationItem key={item.id} notification={item} marking={mark.isPending && mark.variables === item.id} onRead={() => mark.mutate(item.id)} />)}<Pagination page={query.data?.page ?? page} totalPages={query.data?.totalPages ?? 1} onChange={(p) => setParams({ page: String(p) })} /></section></div>; }
