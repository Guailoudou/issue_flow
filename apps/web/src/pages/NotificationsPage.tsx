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

interface NotificationGroup { key: string; notifications: Notification[] }

export function groupNotifications(items: Notification[]): NotificationGroup[] {
  const groups = new Map<string, Notification[]>();
  items.forEach((notification) => {
    const key = notification.issue ? `issue-${notification.issue.id}` : `notification-${notification.id}`;
    const group = groups.get(key);
    if (group) group.push(notification);
    else groups.set(key, [notification]);
  });
  return [...groups].map(([key, notifications]) => ({ key, notifications }));
}

export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') || 1);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['notifications', page], queryFn: () => api<PageResult<Notification>>(`/notifications${queryString({ page, pageSize: 20 })}`) });
  const refresh = () => { void client.invalidateQueries({ queryKey: ['notifications'] }); void client.invalidateQueries({ queryKey: ['notifications-unread'] }); };
  const mark = useMutation({
    mutationFn: ({ notifications }: NotificationGroup) => {
      const notification = notifications[0];
      return notification.issue
        ? api(`/notifications/issues/${notification.issue.id}/read`, { method: 'PATCH' })
        : api(`/notifications/${notification.id}/read`, { method: 'PATCH' });
    },
    onSuccess: refresh,
  });
  const all = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const hasUnread = query.data?.items.some((notification) => !notification.readAt);
  const groups = groupNotifications(query.data?.items ?? []);

  return <div className="page-container">
    <PageHeader title="通知" description="同一 Issue 的动态会合并展示，方便集中查看和处理" actions={hasUnread ? <Button variant="secondary" icon={<CheckCheck className="size-4" aria-hidden="true" />} loading={all.isPending} onClick={() => all.mutate()}>全部标为已读</Button> : undefined} />
    <section className="surface overflow-hidden">
      {query.isPending ? <Spinner /> : query.isError ? <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /> : groups.length === 0 ? <EmptyState icon={Bell} title="暂无通知" description="当 Issue 有新评论、状态或负责人发生变化时，通知会显示在这里。" /> : <div className="divide-y">{groups.map((group) => <NotificationItem key={group.key} notifications={group.notifications} marking={mark.isPending && mark.variables?.key === group.key} onRead={() => mark.mutate(group)} />)}</div>}
      <Pagination page={query.data?.page ?? page} totalPages={query.data?.totalPages ?? 1} onChange={(nextPage) => setParams({ page: String(nextPage) })} />
    </section>
  </div>;
}
