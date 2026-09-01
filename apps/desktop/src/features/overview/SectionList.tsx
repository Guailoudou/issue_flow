import { CheckCircle2, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Badge } from '../../components/Badge';
import { IssueItem } from './IssueItem';
import { tauriBridge } from '../../lib/tauri/bridge';
import type { DesktopIssueItem } from '../../lib/types';

export interface SectionListProps {
  assignedOpen: DesktopIssueItem[];
  followedOpen: DesktopIssueItem[];
  recentlyClosed: DesktopIssueItem[];
  totals?: {
    assignedOpen: number;
    followedOpen: number;
    recentlyClosed: number;
  };
  selectedIndex: number;
  onSelectIssue: (issue: DesktopIssueItem) => void;
  onToggleState: (issue: DesktopIssueItem, e: React.MouseEvent) => void;
  togglingIssueId: number | null;
  flattenedIssues: DesktopIssueItem[];
  collapsed: { [key: string]: boolean };
  onToggleCollapse: (section: string) => void;
  isSearching: boolean;
  searchQuery: string;
  onClearSearch: () => void;
  isOffline?: boolean;
}

export function SectionList({
  assignedOpen,
  followedOpen,
  recentlyClosed,
  totals,
  selectedIndex,
  onSelectIssue,
  onToggleState,
  togglingIssueId,
  flattenedIssues,
  collapsed,
  onToggleCollapse,
  isSearching,
  searchQuery,
  onClearSearch,
  isOffline = false,
}: SectionListProps) {
  const sections = [
    {
      key: 'assigned',
      title: '待我处理',
      items: assignedOpen,
      total: totals?.assignedOpen ?? assignedOpen.length,
      badgeVariant: 'teal' as const,
      emptyText: '暂无待处理的指派 Issue',
    },
    {
      key: 'followed',
      title: '关注中',
      items: followedOpen,
      total: totals?.followedOpen ?? followedOpen.length,
      badgeVariant: 'slate' as const,
      emptyText: '暂无关注中的开放 Issue',
    },
    {
      key: 'closed',
      title: '最近关闭',
      items: recentlyClosed,
      total: totals?.recentlyClosed ?? recentlyClosed.length,
      badgeVariant: 'slate' as const,
      emptyText: '最近没有已关闭的相关 Issue',
    },
  ];

  const totalCount = assignedOpen.length + followedOpen.length + recentlyClosed.length;

  if (totalCount === 0) {
    if (isSearching) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center select-none text-slate-400">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 mb-3">
            <Search className="size-6" aria-hidden="true" />
          </div>
          <h3 className="text-xs font-semibold text-slate-700">无匹配结果</h3>
          <p className="text-[11px] text-slate-400 mt-1 max-w-[220px]">
            未找到与 “{searchQuery}” 相关的 Issue
          </p>
          <button
            type="button"
            onClick={onClearSearch}
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            清除筛选
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center select-none text-slate-400">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 mb-3">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </div>
        <h3 className="text-xs font-semibold text-slate-700">全部处理完成</h3>
        <p className="text-[11px] text-slate-400 mt-1 max-w-[200px]">
          当前没有与您相关的未处理或关注事项
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {sections.map((sec) => {
        const isCollapsed = Boolean(collapsed[sec.key]);
        const hasMore = sec.total > sec.items.length;

        return (
          <div key={sec.key} className="bg-white">
            {/* Section Header */}
            <div className="sticky top-0 z-10 flex w-full items-center justify-between bg-slate-50/90 px-3 py-1.5 backdrop-blur border-y border-slate-100/80">
              <button
                type="button"
                id={`section-header-${sec.key}`}
                aria-expanded={!isCollapsed}
                aria-controls={`section-content-${sec.key}`}
                onClick={() => onToggleCollapse(sec.key)}
                className="flex items-center gap-1.5 text-left select-none hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5 text-slate-400" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3.5 text-slate-400" aria-hidden="true" />
                )}
                <span className="text-[11px] font-semibold text-slate-700">{sec.title}</span>
                <Badge variant={sec.badgeVariant} className="px-1 py-0 text-[10px]">
                  {isSearching
                    ? `${sec.items.length} 匹配`
                    : hasMore
                      ? `${sec.items.length}/${sec.total}`
                      : sec.items.length}
                </Badge>
              </button>

              {!isSearching && hasMore && (
                <button
                  type="button"
                  onClick={() => tauriBridge.openMainSite().catch(() => {})}
                  className="text-[10px] text-slate-400 hover:text-teal-700 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded px-1"
                  title={`浮窗仅展示前 ${sec.items.length} 条，点击在浏览器中查看全部 ${sec.total} 条`}
                >
                  共 {sec.total} 条
                </button>
              )}
            </div>

            {/* Items */}
            <div
              id={`section-content-${sec.key}`}
              role="region"
              aria-labelledby={`section-header-${sec.key}`}
              hidden={isCollapsed}
            >
              {!isCollapsed &&
                (sec.items.length === 0 ? (
                  <div className="py-4 px-3 text-center text-[11px] text-slate-400 italic">
                    {sec.emptyText}
                  </div>
                ) : (
                  sec.items.map((issue) => {
                    const globalIdx = flattenedIssues.findIndex((item) => item.id === issue.id);
                    const isSelected = globalIdx === selectedIndex;
                    return (
                      <IssueItem
                        key={issue.id}
                        issue={issue}
                        isSelected={isSelected}
                        onClick={() => onSelectIssue(issue)}
                        onToggleState={(e) => onToggleState(issue, e)}
                        isToggling={togglingIssueId === issue.id}
                        isOffline={isOffline}
                      />
                    );
                  })
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
