import { ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tauriBridge } from '../../lib/tauri/bridge';
import type { DesktopIssueItem, DesktopOverviewData, RealtimeStatus } from '../../lib/types';
import { formatRelativeTime } from '../../lib/utils';
import { OverviewHeader } from './OverviewHeader';
import { SearchInput } from './SearchInput';
import { SectionList } from './SectionList';
import { UndoToast } from './UndoToast';

export interface OverviewPageProps {
  overviewData: DesktopOverviewData | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  realtimeStatus: RealtimeStatus;
  pinned: boolean;
  onTogglePin: () => Promise<void> | void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onSelectIssue: (issue: DesktopIssueItem) => void;
  serverUrl: string;
}

export function OverviewPage({
  overviewData,
  isLoading,
  isError,
  errorMessage,
  realtimeStatus,
  pinned,
  onTogglePin,
  onRefresh,
  onOpenSettings,
  onSelectIssue,
  serverUrl: _serverUrl,
}: OverviewPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [togglingIssueId, setTogglingIssueId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<{ [key: string]: boolean }>({
    assigned: false,
    followed: false,
    closed: false,
  });
  const [toast, setToast] = useState<{
    message: string;
    issue: DesktopIssueItem;
    targetState: 'OPEN' | 'CLOSED';
    serverUpdatedAt: string;
    expiresAt: number;
  } | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const isOffline = realtimeStatus !== 'connected';

  const toggleSection = useCallback((section: string) => {
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const handleTogglePinWrapped = async () => {
    try {
      await onTogglePin();
    } catch (err) {
      setErrorToast(`无法切换置顶状态: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Filter issues based on search query
  const filteredSections = useMemo(() => {
    if (!overviewData) {
      return { assignedOpen: [], followedOpen: [], recentlyClosed: [] };
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return overviewData.sections;
    }

    const matches = (item: DesktopIssueItem) => {
      const matchId = `#${item.id}`.includes(q) || String(item.id).includes(q);
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchBody = item.bodyExcerpt.toLowerCase().includes(q);
      const matchLabels = item.labels.some((l) => l.name.toLowerCase().includes(q));
      const matchAssignees = item.assignees.some(
        (a) => a.displayName.toLowerCase().includes(q) || a.username.toLowerCase().includes(q),
      );
      return matchId || matchTitle || matchBody || matchLabels || matchAssignees;
    };

    return {
      assignedOpen: overviewData.sections.assignedOpen.filter(matches),
      followedOpen: overviewData.sections.followedOpen.filter(matches),
      recentlyClosed: overviewData.sections.recentlyClosed.filter(matches),
    };
  }, [overviewData, searchQuery]);

  // Flattened list for keyboard navigation - only contains visible items from non-collapsed sections
  const flattenedIssues = useMemo(() => {
    const items: DesktopIssueItem[] = [];
    if (!collapsed.assigned) items.push(...filteredSections.assignedOpen);
    if (!collapsed.followed) items.push(...filteredSections.followedOpen);
    if (!collapsed.closed) items.push(...filteredSections.recentlyClosed);
    return items;
  }, [filteredSections, collapsed]);

  // Clamp selectedIndex when list changes
  useEffect(() => {
    if (selectedIndex >= flattenedIssues.length) {
      setSelectedIndex(Math.max(0, flattenedIssues.length - 1));
    }
  }, [flattenedIssues.length, selectedIndex]);

  // Global keyboard shortcuts & Roving Focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isSearchInput = target === searchInputRef.current;
      const isIssueRowButton = target?.id?.startsWith('issue-row-');

      // ⌘K focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // ⌘, open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        onOpenSettings();
        return;
      }
      // ⌘R refresh
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        onRefresh();
        return;
      }

      if (isSearchInput) {
        if (e.key === 'Escape') {
          if (searchQuery) {
            setSearchQuery('');
          } else {
            searchInputRef.current?.blur();
          }
        }
        return;
      }

      // If focused in input / textarea / editable, do not hijack arrows or Enter
      const isTextInput =
        tagName === 'input' ||
        tagName === 'textarea' ||
        Boolean(target?.isContentEditable);

      if (isTextInput) {
        return;
      }

      // If focused on an interactive button (e.g. settings button, quick action button, section toggle, or row button itself),
      // let native button onClick handle Enter naturally. Do not intercept Enter!
      if (tagName === 'button' || tagName === 'a' || tagName === 'select') {
        if (e.key === 'Enter') {
          return;
        }
      }

      // Arrow navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = Math.min(Math.max(0, flattenedIssues.length - 1), selectedIndex + 1);
        setSelectedIndex(nextIdx);
        if (flattenedIssues[nextIdx]) {
          const el = document.getElementById(`issue-row-${flattenedIssues[nextIdx].id}`);
          el?.focus();
          if (typeof el?.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nextIdx = Math.max(0, selectedIndex - 1);
        setSelectedIndex(nextIdx);
        if (flattenedIssues[nextIdx]) {
          const el = document.getElementById(`issue-row-${flattenedIssues[nextIdx].id}`);
          el?.focus();
          if (typeof el?.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'Enter') {
        // Enter when focus is not on any interactive element (e.g. body or main container)
        if (target === document.body || target?.tagName === 'MAIN') {
          if (flattenedIssues[selectedIndex]) {
            e.preventDefault();
            onSelectIssue(flattenedIssues[selectedIndex]);
          }
        }
      } else if (e.key === 'Escape') {
        if (searchQuery) {
          e.preventDefault();
          setSearchQuery('');
        } else {
          e.preventDefault();
          tauriBridge.hideWindow();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flattenedIssues, selectedIndex, searchQuery, onOpenSettings, onRefresh, onSelectIssue]);

  const handleToggleState = async (issue: DesktopIssueItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOffline) {
      setErrorToast('当前处于离线状态，无法修改 Issue 状态');
      return;
    }

    const nextState = issue.state === 'OPEN' ? 'CLOSED' : 'OPEN';
    setTogglingIssueId(issue.id);
    setErrorToast(null);

    try {
      const result = await tauriBridge.updateIssueState(issue.id, nextState, issue.updatedAt);
      onRefresh();

      // Show 5-second undo toast saving server-returned updatedAt
      setToast({
        message:
          nextState === 'CLOSED'
            ? `已完成 #${issue.id} ${issue.title}`
            : `已重新打开 #${issue.id}`,
        issue,
        targetState: nextState,
        serverUpdatedAt: result.updatedAt,
        expiresAt: Date.now() + 5000,
      });
    } catch (err) {
      if (String(err).includes('STALE_UPDATE')) {
        setErrorToast(`Issue #${issue.id} 已被其他人修改，已自动刷新最新数据`);
        onRefresh();
      } else {
        setErrorToast(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setTogglingIssueId(null);
    }
  };

  const handleUndo = async () => {
    if (!toast) return;
    if (isOffline) {
      setErrorToast('当前处于离线状态，无法执行撤销操作');
      return;
    }
    const { issue, targetState, serverUpdatedAt } = toast;
    const rollbackState = targetState === 'CLOSED' ? 'OPEN' : 'CLOSED';
    setToast(null);

    try {
      await tauriBridge.updateIssueState(issue.id, rollbackState, serverUpdatedAt);
      onRefresh();
    } catch (err) {
      setErrorToast(`撤销失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenWeb = () => {
    tauriBridge.openMainSite().catch(() => {});
  };

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 text-slate-900 select-none overflow-hidden relative">
      {/* Header */}
      <OverviewHeader
        unreadCount={overviewData?.unreadCount ?? 0}
        realtimeStatus={realtimeStatus}
        pinned={pinned}
        onTogglePin={handleTogglePinWrapped}
        onRefresh={onRefresh}
        onOpenSettings={onOpenSettings}
        isRefreshing={isLoading}
      />

      {/* Search Input */}
      <SearchInput
        ref={searchInputRef}
        value={searchQuery}
        onChange={setSearchQuery}
        onClear={() => setSearchQuery('')}
      />

      {/* Stale / offline data warning banner when using cached data while offline or on error */}
      {(isOffline || isError) && overviewData && (
        <div
          role="status"
          className="mx-3 mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800 flex justify-between items-center"
        >
          <span>
            {isError
              ? '数据可能已过期（同步失败）'
              : `已使用离线缓存（快照时间：${formatRelativeTime(overviewData.generatedAt)}）`}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 font-semibold text-amber-900 hover:underline ml-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
          >
            <RefreshCw className="size-3" />
            <span>重试</span>
          </button>
        </div>
      )}

      {/* Error alert toast */}
      {errorToast && (
        <div
          role="alert"
          className="mx-3 mt-2 rounded-lg bg-rose-50 border border-rose-200 p-2 text-xs text-rose-700 flex justify-between items-center"
        >
          <span>{errorToast}</span>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={() => setErrorToast(null)}
            className="text-rose-500 hover:text-rose-700 font-bold ml-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
          >
            ×
          </button>
        </div>
      )}

      {/* Main List */}
      <main className="flex-1 overflow-y-auto" tabIndex={-1}>
        {isLoading && !overviewData ? (
          /* Fixed-height skeleton cards */
          <div className="p-3 space-y-3" aria-busy="true" aria-label="正在加载事项列表">
            <div className="space-y-2">
              <div className="h-5 w-20 bg-slate-200/80 rounded animate-pulse motion-reduce:animate-none" />
              <div className="h-16 w-full bg-white border border-slate-100 rounded-lg p-3 space-y-2 animate-pulse motion-reduce:animate-none">
                <div className="h-3.5 w-3/4 bg-slate-200/70 rounded" />
                <div className="h-3 w-1/2 bg-slate-100 rounded" />
              </div>
              <div className="h-16 w-full bg-white border border-slate-100 rounded-lg p-3 space-y-2 animate-pulse motion-reduce:animate-none">
                <div className="h-3.5 w-2/3 bg-slate-200/70 rounded" />
                <div className="h-3 w-1/3 bg-slate-100 rounded" />
              </div>
            </div>
            <div className="space-y-2 pt-2">
              <div className="h-5 w-16 bg-slate-200/80 rounded animate-pulse motion-reduce:animate-none" />
              <div className="h-16 w-full bg-white border border-slate-100 rounded-lg p-3 space-y-2 animate-pulse motion-reduce:animate-none">
                <div className="h-3.5 w-4/5 bg-slate-200/70 rounded" />
                <div className="h-3 w-2/5 bg-slate-100 rounded" />
              </div>
            </div>
          </div>
        ) : isError && !overviewData ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <p className="text-xs text-rose-600 mb-3">{errorMessage || '获取数据失败'}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <RefreshCw className="size-3.5" />
              <span>重试</span>
            </button>
          </div>
        ) : (
          <SectionList
            assignedOpen={filteredSections.assignedOpen}
            followedOpen={filteredSections.followedOpen}
            recentlyClosed={filteredSections.recentlyClosed}
            totals={overviewData?.totals}
            selectedIndex={selectedIndex}
            onSelectIssue={onSelectIssue}
            onToggleState={handleToggleState}
            togglingIssueId={togglingIssueId}
            flattenedIssues={flattenedIssues}
            collapsed={collapsed}
            onToggleCollapse={toggleSection}
            isSearching={Boolean(searchQuery.trim())}
            searchQuery={searchQuery}
            onClearSearch={() => setSearchQuery('')}
            isOffline={isOffline}
          />
        )}
      </main>

      {/* Undo Toast */}
      {toast && (
        <UndoToast
          key={`${toast.issue.id}-${toast.serverUpdatedAt}-${toast.expiresAt}`}
          message={toast.message}
          onUndo={handleUndo}
          onDismiss={() => setToast(null)}
          durationMs={5000}
          expiresAt={toast.expiresAt}
        />
      )}

      {/* Footer */}
      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-3 text-[11px] text-slate-500">
        <span className="truncate">
          最后同步：
          {overviewData?.generatedAt ? formatRelativeTime(overviewData.generatedAt) : '刚刚'}
        </span>

        <button
          type="button"
          onClick={handleOpenWeb}
          className="flex items-center gap-1 text-slate-600 hover:text-teal-700 hover:underline transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
        >
          <span>打开网页版</span>
          <ExternalLink className="size-3" />
        </button>
      </footer>
    </div>
  );
}
