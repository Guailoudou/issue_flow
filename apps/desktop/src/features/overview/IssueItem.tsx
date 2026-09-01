import { Check, CheckCircle2, CircleDot, RotateCcw, VolumeX } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { formatRelativeTime } from '../../lib/utils';
import type { DesktopIssueItem } from '../../lib/types';

export function IssueItem({
  issue,
  isSelected,
  onClick,
  onToggleState,
  isToggling,
  isOffline = false,
}: {
  issue: DesktopIssueItem;
  isSelected: boolean;
  onClick: () => void;
  onToggleState: (e: React.MouseEvent) => void;
  isToggling: boolean;
  isOffline?: boolean;
}) {
  const isOpen = issue.state === 'OPEN';

  const relationLabels: Record<string, { text: string; variant: 'teal' | 'orange' | 'slate' }> = {
    ASSIGNED: { text: '指派给我', variant: 'teal' },
    MENTIONED: { text: '提到我', variant: 'orange' },
    FOLLOWING: { text: '已关注', variant: 'slate' },
  };

  return (
    <div
      data-issue-id={issue.id}
      className={`group relative flex flex-col gap-1.5 border-b border-slate-100 p-3 transition-colors text-left ${
        isSelected
          ? 'bg-teal-50/80 ring-1 ring-inset ring-brand-500/40'
          : 'hover:bg-slate-50/80 bg-white'
      }`}
    >
      {/* Main navigation clickable header */}
      <button
        type="button"
        id={`issue-row-${issue.id}`}
        tabIndex={isSelected ? 0 : -1}
        onClick={onClick}
        className="flex items-start justify-between gap-2 text-left w-full rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label={`查看 #${issue.id} ${issue.title}`}
      >
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span
            className={`mt-0.5 shrink-0 ${isOpen ? 'text-teal-600' : 'text-slate-400'}`}
            aria-label={isOpen ? '开启' : '已关闭'}
          >
            {isOpen ? (
              <CircleDot className="size-4" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            )}
          </span>

          <span className="shrink-0 text-[11px] font-mono font-semibold text-slate-400">
            #{issue.id}
          </span>

          <h3
            className={`text-xs font-semibold leading-snug line-clamp-2 ${
              isOpen ? 'text-slate-900' : 'text-slate-500 line-through'
            }`}
          >
            {issue.title}
          </h3>
        </div>

        {/* Unread indicator */}
        {issue.unreadCount > 0 && (
          <span
            className="size-2 shrink-0 rounded-full bg-accent-600 mt-1"
            title={`${issue.unreadCount} 条未读动态`}
            aria-label="有未读更新"
          />
        )}
      </button>

      {/* Meta row: Badges, Assignees, Time, Quick Action */}
      <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-slate-500">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {/* Relation reasons */}
          {issue.relationReasons.map((reason) => {
            const cfg = relationLabels[reason];
            if (!cfg) return null;
            return (
              <Badge key={reason} variant={cfg.variant}>
                {cfg.text}
              </Badge>
            );
          })}

          {/* Labels (up to 2) */}
          {issue.labels.slice(0, 2).map((label) => (
            <Badge key={label.id} variant="custom" customBg={label.color}>
              {label.name}
            </Badge>
          ))}

          {/* Additional label count */}
          {issue.additionalLabelCount > 0 && (
            <Badge variant="slate" aria-label={`还有 ${issue.additionalLabelCount} 个标签`}>
              +{issue.additionalLabelCount}
            </Badge>
          )}

          {/* Muted icon */}
          {issue.muted && (
            <span title="已静音通知" aria-label="已静音" className="inline-flex items-center">
              <VolumeX className="size-3 text-slate-400" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Assignees */}
          {issue.assignees.length > 0 && (
            <div className="flex -space-x-1 overflow-hidden">
              {issue.assignees.slice(0, 3).map((u) => (
                <Avatar key={u.id} name={u.displayName || u.username} size="xs" />
              ))}
            </div>
          )}

          <span className="text-[10px] text-slate-400">
            {formatRelativeTime(issue.updatedAt)}
          </span>

          {/* Quick Action Button */}
          <Button
            size="sm"
            variant="ghost"
            tabIndex={isSelected ? 0 : -1}
            disabled={isOffline}
            loading={isToggling}
            onClick={onToggleState}
            title={
              isOffline
                ? '离线只读 / 正在重连，暂不可修改'
                : isOpen
                  ? '快捷完成此 Issue'
                  : '快捷重新打开此 Issue'
            }
            aria-label={
              isOffline
                ? '离线只读，暂不可修改状态'
                : isOpen
                  ? `完成 #${issue.id}`
                  : `重新打开 #${issue.id}`
            }
            className="h-6 px-1.5 text-[11px] opacity-80 hover:opacity-100 hover:bg-slate-200/70 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {isOpen ? (
              <>
                <Check className="size-3 text-teal-600" />
                <span className="text-teal-700">完成</span>
              </>
            ) : (
              <>
                <RotateCcw className="size-3 text-slate-500" />
                <span>重新打开</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
