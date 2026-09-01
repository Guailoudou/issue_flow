import {
  CircleDot,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { RealtimeStatus } from '../../lib/types';
import { useWindowDrag } from '../../lib/tauri/useWindowDrag';

export function OverviewHeader({
  unreadCount,
  realtimeStatus,
  pinned,
  onTogglePin,
  onRefresh,
  onOpenSettings,
  isRefreshing,
}: {
  unreadCount: number;
  realtimeStatus: RealtimeStatus;
  pinned: boolean;
  onTogglePin: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  isRefreshing: boolean;
}) {
  const handleWindowDrag = useWindowDrag();
  const statusConfig = {
    connected: {
      icon: Wifi,
      text: '实时连接',
      color: 'text-teal-600',
      dot: 'bg-teal-500',
    },
    connecting: {
      icon: RefreshCw,
      text: '正在重连…',
      color: 'text-amber-600',
      dot: 'bg-amber-500 animate-pulse',
    },
    disconnected: {
      icon: WifiOff,
      text: '离线模式',
      color: 'text-slate-400',
      dot: 'bg-slate-400',
    },
    unauthenticated: {
      icon: WifiOff,
      text: '未认证',
      color: 'text-red-500',
      dot: 'bg-red-500',
    },
  }[realtimeStatus];

  return (
    <header
      onMouseDown={handleWindowDrag}
      className="flex h-12 shrink-0 cursor-move items-center justify-between border-b border-slate-200/80 bg-white/95 px-3 backdrop-blur select-none"
    >
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-lg bg-brand-600 text-white shadow-xs">
          <CircleDot className="size-4" aria-hidden="true" />
        </div>
        <span className="text-xs font-bold tracking-tight text-slate-900">IssueFlow</span>

        <div
          title={`连接状态: ${statusConfig.text}`}
          className="flex items-center gap-1 text-[11px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100"
        >
          <span className={`size-1.5 rounded-full ${statusConfig.dot}`} aria-hidden="true" />
          <span className="text-[10px]">{statusConfig.text}</span>
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          {unreadCount > 0 ? `当前有 ${unreadCount} 条未读事项` : '当前没有未读事项'}
        </div>

        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="flex items-center justify-center rounded-full bg-accent-600 px-1.5 py-0.2 text-[10px] font-bold text-white shadow-xs"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>

      <div className="flex cursor-default items-center gap-0.5" data-no-window-drag>
        <button
          type="button"
          onClick={onTogglePin}
          title={pinned ? '取消窗口置顶 (当前置顶)' : '开启窗口置顶'}
          className={`flex size-7 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            pinned
              ? 'bg-teal-50 text-teal-700'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
          }`}
          aria-label={pinned ? '取消窗口置顶' : '开启窗口置顶'}
        >
          {pinned ? <Pin className="size-3.5 fill-teal-600" /> : <PinOff className="size-3.5" />}
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="刷新列表 (⌘R)"
          className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="刷新"
        >
          <RefreshCw
            className={`size-3.5 ${isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
          />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          title="偏好设置 (⌘,)"
          className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="偏好设置"
        >
          <Settings className="size-3.5" />
        </button>
      </div>
    </header>
  );
}
