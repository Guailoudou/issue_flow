import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from './OverviewPage';
import { tauriBridge } from '../../lib/tauri/bridge';
import type { DesktopOverviewData } from '../../lib/types';

const mockOverview: DesktopOverviewData = {
  generatedAt: '2026-08-31T10:00:00.000Z',
  unreadCount: 3,
  sections: {
    assignedOpen: [
      {
        id: 101,
        title: '待我处理的紧急任务',
        state: 'OPEN',
        bodyExcerpt: '这是一个测试任务描述',
        updatedAt: '2026-08-31T09:30:00.000Z',
        closedAt: null,
        relationReasons: ['ASSIGNED'],
        assignees: [{ id: 1, username: 'alex', displayName: 'Alex Chen' }],
        labels: [{ id: 1, name: '前端', color: '0D9488' }],
        additionalLabelCount: 0,
        unreadCount: 2,
        subscribed: true,
        muted: false,
        latestNotification: {
          id: 501,
          issueId: 101,
          type: 'ASSIGNED',
          message: 'Alex 指派了任务给你',
          readAt: null,
          createdAt: '2026-08-31T09:30:00.000Z',
        },
      },
      {
        id: 102,
        title: '需要跟进的讨论项',
        state: 'OPEN',
        bodyExcerpt: '讨论设计方案',
        updatedAt: '2026-08-31T08:00:00.000Z',
        closedAt: null,
        relationReasons: ['MENTIONED'],
        assignees: [],
        labels: [],
        additionalLabelCount: 0,
        unreadCount: 0,
        subscribed: false,
        muted: true,
        latestNotification: null,
      },
    ],
    followedOpen: [
      {
        id: 201,
        title: '关注的后端服务重构',
        state: 'OPEN',
        bodyExcerpt: '重构数据库连接池',
        updatedAt: '2026-08-30T10:00:00.000Z',
        closedAt: null,
        relationReasons: ['FOLLOWING'],
        assignees: [{ id: 2, username: 'bob', displayName: 'Bob' }],
        labels: [{ id: 2, name: '后端', color: 'EA580C' }],
        additionalLabelCount: 0,
        unreadCount: 0,
        subscribed: true,
        muted: false,
        latestNotification: null,
      },
    ],
    recentlyClosed: [],
  },
  totals: {
    assignedOpen: 2,
    followedOpen: 1,
    recentlyClosed: 0,
  },
};

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders overview header, sections, unread counts, and search input', () => {
    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    expect(screen.getByText('IssueFlow')).toBeInTheDocument();
    expect(screen.getByText('待我处理')).toBeInTheDocument();
    expect(screen.getByText('关注中')).toBeInTheDocument();
    expect(screen.getByText('待我处理的紧急任务')).toBeInTheDocument();
    expect(screen.getByText('需要跟进的讨论项')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/搜索 Issue 标题或描述/)).toBeInTheDocument();
  });

  it('supports global shortcuts when outside interactive elements', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onSettings = vi.fn();

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={onRefresh}
        onOpenSettings={onSettings}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    await user.keyboard('{Meta>}{r}{/Meta}');
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await user.keyboard('{Meta>},{/Meta}');
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('ignores global shortcuts when focus is on an interactive element like input or button', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onSettings = vi.fn();

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={onRefresh}
        onOpenSettings={onSettings}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    const searchInput = screen.getByPlaceholderText(/搜索 Issue 标题或描述/);
    await user.click(searchInput);
    expect(searchInput).toHaveFocus();

    // Type inside search input - should NOT trigger onRefresh or onSettings
    await user.type(searchInput, 'r');
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
  });

  it('filters issues across sections when typing in search input', async () => {
    const user = userEvent.setup();

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    const searchInput = screen.getByPlaceholderText(/搜索 Issue 标题或描述/);
    await user.type(searchInput, '后端');

    expect(screen.queryByText('待我处理的紧急任务')).not.toBeInTheDocument();
    expect(screen.getByText('关注的后端服务重构')).toBeInTheDocument();
  });

  it('supports section collapsing and expanding', async () => {
    const user = userEvent.setup();

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    expect(screen.getByText('待我处理的紧急任务')).toBeInTheDocument();

    const collapseBtn = document.getElementById('section-header-assigned') as HTMLButtonElement;
    await user.click(collapseBtn);

    expect(screen.queryByText('待我处理的紧急任务')).not.toBeInTheDocument();

    await user.click(collapseBtn);
    expect(screen.getByText('待我处理的紧急任务')).toBeInTheDocument();
  });

  it('calls updateIssueState when quick-action button is clicked', async () => {
    const updateSpy = vi.spyOn(tauriBridge, 'updateIssueState').mockResolvedValue({
      id: 101,
      state: 'CLOSED',
      updatedAt: '2026-08-31T09:40:00.000Z',
      closedAt: '2026-08-31T09:40:00.000Z',
    });

    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={onRefresh}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    const completeBtns = screen.getAllByTitle(/快捷完成此 Issue/);
    expect(completeBtns.length).toBeGreaterThan(0);

    await user.click(completeBtns[0]);

    expect(updateSpy).toHaveBeenCalledWith(101, 'CLOSED', expect.any(String));
    expect(await screen.findByText(/已完成 #101/)).toBeInTheDocument();
  });

  it('supports keyboard ArrowDown/ArrowUp navigation and Enter to open issue', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={onSelect}
        serverUrl="http://localhost:3101"
      />,
    );

    const row1 = screen.getByRole('button', { name: /查看 #101/ });
    const row2 = screen.getByRole('button', { name: /查看 #102/ });

    expect(row1).toHaveAttribute('tabIndex', '0');
    expect(row2).toHaveAttribute('tabIndex', '-1');

    // Tab into page and focus roving list
    row1.focus();
    expect(document.activeElement).toBe(row1);

    // ArrowDown moves active selection and DOM focus to row2
    await user.keyboard('{ArrowDown}');
    expect(row1).toHaveAttribute('tabIndex', '-1');
    expect(row2).toHaveAttribute('tabIndex', '0');
    expect(document.activeElement).toBe(row2);

    // Enter on active row opens issue detail
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 102 }));
  });

  it('does not trigger onSelectIssue when pressing Enter on search input, collapse header, or quick action button', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    vi.spyOn(tauriBridge, 'updateIssueState').mockResolvedValue({
      id: 101,
      state: 'CLOSED',
      updatedAt: '2026-08-31T09:40:00.000Z',
      closedAt: '2026-08-31T09:40:00.000Z',
    });

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={onSelect}
        serverUrl="http://localhost:3101"
      />,
    );

    // 1. Enter inside search input does NOT open detail
    const searchInput = screen.getByPlaceholderText(/搜索 Issue 标题或描述/);
    await user.click(searchInput);
    expect(searchInput).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();

    // 2. Enter on collapse button toggles collapse, does NOT open detail
    const collapseBtn = document.getElementById('section-header-assigned') as HTMLButtonElement;
    collapseBtn.focus();
    expect(document.activeElement).toBe(collapseBtn);
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();

    // 3. Enter on quick action button toggles issue status, does NOT open detail
    const completeBtns = screen.getAllByTitle(/快捷完成此 Issue/);
    completeBtns[0].focus();
    expect(document.activeElement).toBe(completeBtns[0]);
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('proves that undo after closing an issue uses the server-returned updatedAt version', async () => {
    const serverReturnedUpdatedAt = '2026-08-31T12:34:56.789Z';
    const initialUpdatedAt = '2026-08-31T10:00:00.000Z';

    const testOverview: DesktopOverviewData = {
      ...mockOverview,
      sections: {
        ...mockOverview.sections,
        assignedOpen: [
          {
            ...mockOverview.sections.assignedOpen[0],
            id: 202,
            title: '测试撤销版本一致性事项',
            state: 'OPEN',
            updatedAt: initialUpdatedAt,
          },
        ],
      },
    };

    const updateSpy = vi
      .spyOn(tauriBridge, 'updateIssueState')
      .mockImplementation(async (issueId, state) => {
        if (state === 'CLOSED') {
          return {
            id: issueId,
            state: 'CLOSED',
            updatedAt: serverReturnedUpdatedAt,
            closedAt: serverReturnedUpdatedAt,
          };
        }
        return {
          id: issueId,
          state: 'OPEN',
          updatedAt: '2026-08-31T12:35:00.000Z',
          closedAt: null,
        };
      });

    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <OverviewPage
        overviewData={testOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={onRefresh}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    const completeBtns = screen.getAllByTitle(/快捷完成此 Issue/);
    await user.click(completeBtns[0]);

    expect(updateSpy).toHaveBeenNthCalledWith(1, 202, 'CLOSED', initialUpdatedAt);

    const undoButton = await screen.findByRole('button', { name: '撤销' });
    expect(undoButton).toBeInTheDocument();

    await user.click(undoButton);

    expect(updateSpy).toHaveBeenNthCalledWith(2, 202, 'OPEN', serverReturnedUpdatedAt);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('displays "无匹配结果" with clear filter button when search yields no matches', async () => {
    const user = userEvent.setup();

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    const searchInput = screen.getByPlaceholderText(/搜索 Issue 标题或描述/);
    await user.type(searchInput, '没有任何匹配的内容XYZ');

    expect(screen.getByText('无匹配结果')).toBeInTheDocument();
    expect(screen.queryByText('全部处理完成')).not.toBeInTheDocument();

    const clearBtn = screen.getByRole('button', { name: '清除筛选' });
    await user.click(clearBtn);

    expect(screen.getByText('待我处理的紧急任务')).toBeInTheDocument();
  });

  it('displays stale data warning banner when sync failed but cached data exists', () => {
    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={true}
        errorMessage="网络连接超时"
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    expect(screen.getByText('数据可能已过期（同步失败）')).toBeInTheDocument();
    expect(screen.getByText('待我处理的紧急任务')).toBeInTheDocument();
  });

  it('displays immediate offline cache banner with snapshot time when disconnected', () => {
    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="disconnected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    expect(screen.getByText(/已使用离线缓存/)).toBeInTheDocument();
    expect(screen.getByText('待我处理的紧急任务')).toBeInTheDocument();
  });

  it('disables quick action buttons when offline', () => {
    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="disconnected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={vi.fn()}
        serverUrl="http://localhost:3101"
      />,
    );

    const completeBtns = screen.getAllByRole('button', { name: /离线只读/ });
    expect(completeBtns.length).toBeGreaterThan(0);
    expect(completeBtns[0]).toBeDisabled();
  });

  it('supports Tab focus sequence from search input to row button and quick action button, and Enter behaviors', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const updateSpy = vi.spyOn(tauriBridge, 'updateIssueState').mockResolvedValue({
      id: 101,
      state: 'CLOSED',
      updatedAt: '2026-08-31T09:40:00.000Z',
      closedAt: '2026-08-31T09:40:00.000Z',
    });

    render(
      <OverviewPage
        overviewData={mockOverview}
        isLoading={false}
        isError={false}
        realtimeStatus="connected"
        pinned={false}
        onTogglePin={vi.fn()}
        onRefresh={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectIssue={onSelect}
        serverUrl="http://localhost:3101"
      />,
    );

    const searchInput = screen.getByPlaceholderText(/搜索 Issue 标题或描述/);
    const row1 = screen.getByRole('button', { name: /查看 #101/ });
    const quickAction1 = screen.getByRole('button', { name: /完成 #101/ });
    const row2 = screen.getByRole('button', { name: /查看 #102/ });

    // Focus search input
    await user.click(searchInput);
    expect(document.activeElement).toBe(searchInput);

    // Tab onto section toggle / row 1
    row1.focus();
    expect(document.activeElement).toBe(row1);
    expect(row1).toHaveAttribute('tabIndex', '0');

    // Tab onto quick action 1
    await user.tab();
    expect(document.activeElement).toBe(quickAction1);
    expect(quickAction1).toHaveAttribute('tabIndex', '0');

    // Enter on quick action toggles state, does NOT enter detail
    await user.keyboard('{Enter}');
    expect(updateSpy).toHaveBeenCalledWith(101, 'CLOSED', expect.any(String));
    expect(onSelect).not.toHaveBeenCalled();

    // ArrowDown updates active selection and DOM focus to row2
    row1.focus();
    expect(document.activeElement).toBe(row1);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row2);
    expect(row2).toHaveAttribute('tabIndex', '0');
    expect(row1).toHaveAttribute('tabIndex', '-1');

    // Enter on row2 enters detail exactly once
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 102 }));
  });
});
