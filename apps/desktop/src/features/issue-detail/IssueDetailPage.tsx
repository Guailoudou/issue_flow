import {
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  ExternalLink,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { UndoToast } from '../overview/UndoToast';
import { tauriBridge } from '../../lib/tauri/bridge';
import { useWindowDrag } from '../../lib/tauri/useWindowDrag';
import type { DesktopIssueItem, RealtimeStatus } from '../../lib/types';
import { formatFullTime } from '../../lib/utils';

export interface IssueDetailPageProps {
  issue: DesktopIssueItem;
  onBack: () => void;
  onRefresh: () => void;
  serverUrl: string;
  realtimeStatus?: RealtimeStatus;
}

export function IssueDetailPage({
  issue: initialIssue,
  onBack,
  onRefresh,
  serverUrl,
  realtimeStatus = 'connected',
}: IssueDetailPageProps) {
  const handleWindowDrag = useWindowDrag();
  const [issue, setIssue] = useState<DesktopIssueItem>(initialIssue);
  const [isTogglingState, setIsTogglingState] = useState(false);
  const [isTogglingSub, setIsTogglingSub] = useState(false);
  const [isTogglingMute, setIsTogglingMute] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    targetState: 'OPEN' | 'CLOSED';
    serverUpdatedAt: string;
    expiresAt: number;
  } | null>(null);

  const isOffline = realtimeStatus !== 'connected';
  const inFlightMarkReadRef = useRef(false);

  // Absorb newer version or merge independent realtime fields on same version
  useEffect(() => {
    if (initialIssue.id === issue.id) {
      const initialTime = new Date(initialIssue.updatedAt).getTime();
      const currentTime = new Date(issue.updatedAt).getTime();
      if (initialTime > currentTime) {
        setIssue(initialIssue);
      } else if (initialTime === currentTime) {
        setIssue(initialIssue);
      } else {
        // Older updatedAt: NEVER overwrite state, closedAt, title, etc.
        // ONLY merge independent realtime fields (subscribed, muted, unreadCount, latestNotification)
        setIssue((prev) => ({
          ...prev,
          subscribed: initialIssue.subscribed,
          muted: initialIssue.muted,
          unreadCount: initialIssue.unreadCount,
          latestNotification: initialIssue.latestNotification,
        }));
      }
    }
  }, [initialIssue, issue.id]);

  // Set focused issue on desktop backend
  useEffect(() => {
    tauriBridge.setFocusedIssue(issue.id).catch(() => {});
    return () => {
      tauriBridge.setFocusedIssue(null).catch(() => {});
    };
  }, [issue.id]);

  // Automatically mark issue notifications as read when unreadCount > 0, and sync local state
  useEffect(() => {
    if (!isOffline && issue.unreadCount > 0 && !inFlightMarkReadRef.current) {
      inFlightMarkReadRef.current = true;
      tauriBridge
        .markIssueNotificationsRead(issue.id)
        .then(() => {
          setIssue((prev) => ({
            ...prev,
            unreadCount: 0,
            latestNotification: prev.latestNotification
              ? { ...prev.latestNotification, readAt: new Date().toISOString() }
              : null,
          }));
          onRefresh();
        })
        .catch((err) => {
          setActionError(
            `标记已读失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => {
          inFlightMarkReadRef.current = false;
        });
    }
  }, [issue.id, issue.unreadCount, isOffline, onRefresh]);

  // Esc hotkey to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  const isOpen = issue.state === 'OPEN';

  const handleToggleState = async () => {
    if (isOffline) {
      setActionError('当前处于离线状态，无法修改 Issue 状态');
      return;
    }
    const nextState = isOpen ? 'CLOSED' : 'OPEN';
    setIsTogglingState(true);
    setActionError(null);

    try {
      const updated = await tauriBridge.updateIssueState(
        issue.id,
        nextState,
        issue.updatedAt,
      );
      // Merge returned fields first
      setIssue((prev) => ({
        ...prev,
        state: updated.state,
        updatedAt: updated.updatedAt,
        closedAt: updated.closedAt,
      }));

      // 5-second undo toast
      setToast({
        message: nextState === 'CLOSED' ? '已标记为已完成' : '已重新打开 Issue',
        targetState: nextState,
        serverUpdatedAt: updated.updatedAt,
        expiresAt: Date.now() + 5000,
      });

      onRefresh();
    } catch (err) {
      if (String(err).includes('STALE_UPDATE')) {
        setActionError('该 Issue 已被其他人修改，请返回刷新后重试');
      } else {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsTogglingState(false);
    }
  };

  const handleUndo = async () => {
    if (!toast) return;
    if (isOffline) {
      setActionError('当前处于离线状态，无法执行撤销操作');
      return;
    }
    const rollbackState = toast.targetState === 'CLOSED' ? 'OPEN' : 'CLOSED';
    const serverUpdatedAt = toast.serverUpdatedAt;
    setToast(null);

    try {
      const rolledBack = await tauriBridge.updateIssueState(
        issue.id,
        rollbackState,
        serverUpdatedAt,
      );
      setIssue((prev) => ({
        ...prev,
        state: rolledBack.state,
        updatedAt: rolledBack.updatedAt,
        closedAt: rolledBack.closedAt,
      }));
      onRefresh();
    } catch (err) {
      setActionError(`撤销失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleSubscription = async () => {
    if (isOffline) {
      setActionError('当前处于离线状态，无法修改关注设置');
      return;
    }
    const nextSub = !issue.subscribed;
    setIsTogglingSub(true);
    setActionError(null);

    try {
      await tauriBridge.setIssueSubscription(issue.id, nextSub);
      setIssue((prev) => ({ ...prev, subscribed: nextSub }));
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTogglingSub(false);
    }
  };

  const handleToggleMute = async () => {
    if (isOffline) {
      setActionError('当前处于离线状态，无法修改静音设置');
      return;
    }
    const nextMute = !issue.muted;
    setIsTogglingMute(true);
    setActionError(null);

    try {
      await tauriBridge.setIssueMute(issue.id, nextMute);
      setIssue((prev) => ({ ...prev, muted: nextMute }));
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTogglingMute(false);
    }
  };

  const handleOpenInWeb = () => {
    tauriBridge.openMainSite(issue.id).catch(() => {});
  };

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 text-slate-900 select-none overflow-hidden relative">
      {/* Header */}
      <header
        onMouseDown={handleWindowDrag}
        className="flex h-12 shrink-0 cursor-move items-center justify-between border-b border-slate-200 bg-white px-3 select-none"
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="返回列表 (Esc)"
        >
          <ChevronLeft className="size-4" />
          <span>返回 (Esc)</span>
        </button>

        <div className="flex items-center gap-1.5">
          {isOffline && (
            <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
              离线只读
            </span>
          )}
          <Badge variant={isOpen ? 'teal' : 'slate'} className="px-2 py-0.5">
            {isOpen ? '进行中' : '已关闭'}
          </Badge>
          <span className="font-mono text-xs font-bold text-slate-400">#{issue.id}</span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {actionError && (
          <div
            role="alert"
            className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700"
          >
            {actionError}
          </div>
        )}

        {/* Title */}
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <span
              className={`mt-1 shrink-0 ${isOpen ? 'text-teal-600' : 'text-slate-400'}`}
              aria-hidden="true"
            >
              {isOpen ? <CircleDot className="size-5" /> : <CheckCircle2 className="size-5" />}
            </span>
            <h1 className="text-sm font-bold leading-snug text-slate-900">{issue.title}</h1>
          </div>
        </div>

        {/* Metadata */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5 text-xs">
          {/* Assignees */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-[11px]">负责人</span>
            <div className="flex items-center gap-1.5">
              {issue.assignees.length === 0 ? (
                <span className="text-slate-400">未指派</span>
              ) : (
                issue.assignees.map((u) => (
                  <div key={u.id} className="flex items-center gap-1">
                    <Avatar name={u.displayName || u.username} size="xs" />
                    <span className="font-medium text-slate-700">
                      {u.displayName || u.username}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Labels */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-[11px]">标签</span>
            <div className="flex flex-wrap items-center gap-1">
              {issue.labels.length === 0 && issue.additionalLabelCount === 0 ? (
                <span className="text-slate-400">无标签</span>
              ) : (
                <>
                  {issue.labels.map((l) => (
                    <Badge key={l.id} variant="custom" customBg={l.color}>
                      {l.name}
                    </Badge>
                  ))}
                  {issue.additionalLabelCount > 0 && (
                    <Badge
                      variant="slate"
                      aria-label={`还有 ${issue.additionalLabelCount} 个标签`}
                    >
                      +{issue.additionalLabelCount}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Updated time */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-[11px]">更新时间</span>
            <span className="text-slate-600 font-mono text-[11px]">
              {formatFullTime(issue.updatedAt)}
            </span>
          </div>
        </div>

        {/* Body excerpt */}
        <div className="space-y-1.5">
          <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Issue 概要
          </h2>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap select-text max-h-36 overflow-y-auto">
            {issue.bodyExcerpt || <span className="text-slate-400 italic">暂无正文内容</span>}
          </div>
        </div>

        {/* Latest Notification */}
        {issue.latestNotification && (
          <div className="space-y-1.5">
            <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              最新提醒
            </h2>
            <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-xs text-slate-700 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-teal-800 font-semibold">
                <span>{issue.latestNotification.type}</span>
                <span className="font-normal font-mono text-slate-400">
                  {formatFullTime(issue.latestNotification.createdAt)}
                </span>
              </div>
              <p className="text-slate-800">{issue.latestNotification.message}</p>
            </div>
          </div>
        )}
      </main>

      {/* Undo Toast */}
      {toast && (
        <UndoToast
          message={toast.message}
          onUndo={handleUndo}
          onDismiss={() => setToast(null)}
          durationMs={5000}
          expiresAt={toast.expiresAt}
        />
      )}

      {/* Action Bar */}
      <footer className="border-t border-slate-200 bg-white p-3 space-y-2">
        <div className="flex gap-2">
          {/* Complete / Reopen Button */}
          <Button
            variant={isOpen ? 'teal' : 'secondary'}
            disabled={isOffline}
            loading={isTogglingState}
            onClick={handleToggleState}
            className="flex-1 disabled:opacity-50"
            title={isOffline ? '离线只读，暂不可修改状态' : undefined}
            icon={
              isOpen ? <Check className="size-3.5" /> : <RotateCcw className="size-3.5" />
            }
          >
            {isOpen ? '标记为已完成' : '重新打开 Issue'}
          </Button>

          {/* Open in Web Button */}
          <Button
            variant="secondary"
            onClick={handleOpenInWeb}
            title="在主站浏览器中打开详情"
            icon={<ExternalLink className="size-3.5" />}
          >
            在主站打开
          </Button>
        </div>

        <div className="flex items-center justify-between pt-1 text-xs">
          {/* Subscription toggle */}
          <button
            type="button"
            disabled={isTogglingSub || isOffline}
            onClick={handleToggleSubscription}
            title={isOffline ? '离线只读，暂不可修改关注' : undefined}
            className="flex items-center gap-1 text-slate-600 hover:text-teal-700 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1"
          >
            {issue.subscribed ? (
              <>
                <BellOff className="size-3.5 text-slate-400" />
                <span>取消关注</span>
              </>
            ) : (
              <>
                <Bell className="size-3.5 text-teal-600" />
                <span>关注此 Issue</span>
              </>
            )}
          </button>

          {/* Mute toggle */}
          <button
            type="button"
            disabled={isTogglingMute || isOffline}
            onClick={handleToggleMute}
            title={isOffline ? '离线只读，暂不可修改静音' : undefined}
            className="flex items-center gap-1 text-slate-600 hover:text-teal-700 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1"
          >
            {issue.muted ? (
              <>
                <Volume2 className="size-3.5 text-teal-600" />
                <span>取消静音</span>
              </>
            ) : (
              <>
                <VolumeX className="size-3.5 text-slate-400" />
                <span>静音提醒</span>
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
