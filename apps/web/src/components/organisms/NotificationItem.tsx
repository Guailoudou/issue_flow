import { Bell, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Notification } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { Button } from '../atoms/Button';

export function NotificationItem({ notification, marking, onRead }: { notification: Notification; marking?: boolean; onRead: () => void }) {
  return <article className={`flex gap-3 border-b p-4 last:border-b-0 ${notification.readAt ? 'bg-white' : 'bg-brand-50'}`}>
    <span className={`mt-1 flex size-9 shrink-0 items-center justify-center rounded-full ${notification.readAt ? 'bg-slate-100 text-slate-500' : 'bg-brand-100 text-brand-700'}`}><Bell className="size-4" /></span>
    <div className="min-w-0 flex-1">{notification.issue ? <Link className="font-semibold hover:text-brand-700 hover:underline" to={`/issues/${notification.issue.id}`}>{notification.title || notification.issue.title}</Link> : <p className="font-semibold">{notification.title || '系统通知'}</p>}<p className="mt-1 text-sm text-slate-600">{notification.message}</p><time className="mt-1 block text-xs text-slate-500" dateTime={notification.createdAt}>{formatDate(notification.createdAt)}</time></div>
    {!notification.readAt && <Button variant="ghost" loading={marking} icon={<Check className="size-4" />} onClick={onRead} aria-label="标记为已读"><span className="hidden sm:inline">已读</span></Button>}
  </article>;
}
