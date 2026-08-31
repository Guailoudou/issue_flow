import { Bell, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Notification } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';

export function NotificationItem({ notifications, marking, onRead }: { notifications: Notification[]; marking?: boolean; onRead: () => void }) {
  const latest = notifications[0];
  if (!latest) return null;
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const issue = latest.issue;
  const readLabel = issue ? `将 Issue #${issue.id} 的通知全部标为已读` : '标记为已读';

  return <article className={`flex gap-3 p-4 transition-colors duration-200 ${unreadCount ? 'bg-brand-50' : 'bg-white'}`}>
    <span className={`mt-1 flex size-9 shrink-0 items-center justify-center rounded-full ${unreadCount ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`} aria-hidden="true"><Bell className="size-4" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 font-semibold text-slate-900">{issue ? <Link className="break-words transition-colors hover:text-brand-700 hover:underline" to={`/issues/${issue.id}`}>#{issue.id} {latest.title || issue.title}</Link> : latest.title || '系统通知'}</h2>
        {issue && notifications.length > 1 && <Badge className="border-slate-200 bg-white text-slate-600">{notifications.length} 条动态</Badge>}
        {unreadCount > 0 && <Badge className="border-brand-200 bg-brand-100 text-brand-800">{unreadCount} 条未读</Badge>}
      </div>
      <ul className="mt-3 space-y-3" aria-label={issue ? `Issue #${issue.id} 的通知动态` : undefined}>
        {notifications.map((notification) => <li key={notification.id} className="flex min-w-0 gap-2 text-sm">
          <span className={`mt-2 size-1.5 shrink-0 rounded-full ${notification.readAt ? 'bg-slate-300' : 'bg-brand-600'}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="break-words text-slate-700">{notification.message}</p>
            <time className="mt-0.5 block text-xs text-slate-500" dateTime={notification.createdAt}>{formatDate(notification.createdAt)}</time>
          </div>
        </li>)}
      </ul>
    </div>
    {unreadCount > 0 && <Button variant="ghost" className="shrink-0 px-3" loading={marking} icon={<Check className="size-4" aria-hidden="true" />} onClick={onRead} aria-label={readLabel}><span className="hidden sm:inline">全部已读</span></Button>}
  </article>;
}
