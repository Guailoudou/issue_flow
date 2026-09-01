import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IssueDetailPage } from './IssueDetailPage';
import type { DesktopIssueItem } from '../../lib/types';
import { tauriBridge } from '../../lib/tauri/bridge';

const mockIssue: DesktopIssueItem = {
  id: 42,
  title: 'macOS 浮窗实时同步重构',
  state: 'OPEN',
  bodyExcerpt: '通过 WebSocket 实现 1~3 秒内的事件推送与状态更新。',
  updatedAt: new Date().toISOString(),
  closedAt: null,
  relationReasons: ['ASSIGNED', 'MENTIONED'],
  assignees: [{ id: 1, username: 'alex', displayName: 'Alex Chen' }],
  labels: [{ id: 1, name: 'Desktop', color: '0D9488' }],
  additionalLabelCount: 0,
  unreadCount: 1,
  subscribed: true,
  muted: false,
  latestNotification: {
    id: 10,
    issueId: 42,
    type: 'MENTIONED',
    message: '@alex 请确认状态同步逻辑',
    readAt: null,
    createdAt: new Date().toISOString(),
  },
};

describe('IssueDetailPage', () => {
  it('renders issue details and handles actions', async () => {
    const markReadSpy = vi.spyOn(tauriBridge, 'markIssueNotificationsRead').mockResolvedValue();
    const updateStateSpy = vi.spyOn(tauriBridge, 'updateIssueState').mockResolvedValue({
      id: 42,
      state: 'CLOSED',
      updatedAt: new Date().toISOString(),
      closedAt: new Date().toISOString(),
    });
    const subSpy = vi.spyOn(tauriBridge, 'setIssueSubscription').mockResolvedValue();
    const muteSpy = vi.spyOn(tauriBridge, 'setIssueMute').mockResolvedValue();

    const user = userEvent.setup();
    const onBack = vi.fn();
    const onRefresh = vi.fn();

    render(
      <IssueDetailPage
        issue={mockIssue}
        onBack={onBack}
        onRefresh={onRefresh}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    expect(markReadSpy).toHaveBeenCalledWith(42);
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('macOS 浮窗实时同步重构')).toBeInTheDocument();
    expect(screen.getByText('Alex Chen')).toBeInTheDocument();
    expect(screen.getByText('Desktop')).toBeInTheDocument();
    expect(screen.getByText('@alex 请确认状态同步逻辑')).toBeInTheDocument();

    // Toggle complete
    await user.click(screen.getByRole('button', { name: /标记为已完成/ }));
    expect(updateStateSpy).toHaveBeenCalledWith(42, 'CLOSED', expect.any(String));

    // Toggle unsubscribe
    await user.click(screen.getByRole('button', { name: /取消关注/ }));
    expect(subSpy).toHaveBeenCalledWith(42, false);

    // Toggle mute
    await user.click(screen.getByRole('button', { name: /静音提醒/ }));
    expect(muteSpy).toHaveBeenCalledWith(42, true);

    // Click back
    await user.click(screen.getByRole('button', { name: /返回/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('provides 5s undo in detail page using server-returned updatedAt', async () => {
    const serverReturnedUpdatedAt = '2026-08-31T15:00:00.000Z';
    const initialUpdatedAt = mockIssue.updatedAt;

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
          updatedAt: '2026-08-31T15:01:00.000Z',
          closedAt: null,
        };
      });

    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <IssueDetailPage
        issue={{ ...mockIssue, unreadCount: 0 }}
        onBack={vi.fn()}
        onRefresh={onRefresh}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    // Toggle complete
    await user.click(screen.getByRole('button', { name: /标记为已完成/ }));
    expect(updateSpy).toHaveBeenNthCalledWith(1, 42, 'CLOSED', initialUpdatedAt);

    // Toast appears
    const undoButton = await screen.findByRole('button', { name: '撤销' });
    expect(undoButton).toBeInTheDocument();

    // Click undo
    await user.click(undoButton);
    expect(updateSpy).toHaveBeenNthCalledWith(2, 42, 'OPEN', serverReturnedUpdatedAt);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('disables mutation actions when offline and skips markRead', () => {
    const markReadSpy = vi.spyOn(tauriBridge, 'markIssueNotificationsRead');

    render(
      <IssueDetailPage
        issue={mockIssue}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        serverUrl="http://localhost:3101"
        realtimeStatus="disconnected"
      />,
    );

    expect(markReadSpy).not.toHaveBeenCalled();
    expect(screen.getByText('离线只读')).toBeInTheDocument();

    const completeBtn = screen.getByRole('button', { name: /标记为已完成/ });
    expect(completeBtn).toBeDisabled();

    const subBtn = screen.getByRole('button', { name: /取消关注/ });
    expect(subBtn).toBeDisabled();

    const muteBtn = screen.getByRole('button', { name: /静音提醒/ });
    expect(muteBtn).toBeDisabled();
  });

  it('merges same-version remote mute and subscription updates without losing latest local state', async () => {
    vi.spyOn(tauriBridge, 'markIssueNotificationsRead').mockResolvedValue();
    const timestamp = '2026-08-31T12:00:00.000Z';
    const initial = { ...mockIssue, updatedAt: timestamp, muted: false, subscribed: true };

    const { rerender } = render(
      <IssueDetailPage
        issue={initial}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    expect(screen.getByRole('button', { name: /静音提醒/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /取消关注/ })).toBeInTheDocument();

    // Rerender with remote mute changed on same updatedAt
    rerender(
      <IssueDetailPage
        issue={{ ...initial, muted: true }}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    // Button should now reflect muted = true ('取消静音')
    expect(await screen.findByRole('button', { name: /取消静音/ })).toBeInTheDocument();

    // Rerender with remote unsubscribe on same updatedAt
    rerender(
      <IssueDetailPage
        issue={{ ...initial, muted: true, subscribed: false }}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    expect(await screen.findByRole('button', { name: /关注此 Issue/ })).toBeInTheDocument();
  });

  it('displays actionError when mark read fails', async () => {
    vi.spyOn(tauriBridge, 'markIssueNotificationsRead').mockRejectedValueOnce(
      new Error('Failed to update read status on server'),
    );

    render(
      <IssueDetailPage
        issue={{ ...mockIssue, unreadCount: 2 }}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    expect(
      await screen.findByText(/标记已读失败: Failed to update read status on server/),
    ).toBeInTheDocument();
  });

  it('does not overwrite state or closedAt when an older version is received, but merges independent fields', async () => {
    vi.spyOn(tauriBridge, 'markIssueNotificationsRead').mockResolvedValue();

    // Local issue has state CLOSED with newer updatedAt 14:00:00Z
    const localIssue: DesktopIssueItem = {
      ...mockIssue,
      state: 'CLOSED',
      closedAt: '2026-08-31T14:00:00.000Z',
      updatedAt: '2026-08-31T14:00:00.000Z',
      subscribed: true,
      muted: false,
    };

    const { rerender } = render(
      <IssueDetailPage
        issue={localIssue}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    expect(screen.getByRole('button', { name: /重新打开 Issue/ })).toBeInTheDocument();

    // Older version arrives (13:00:00Z) with state OPEN and muted = true
    const olderIssue: DesktopIssueItem = {
      ...mockIssue,
      state: 'OPEN',
      closedAt: null,
      updatedAt: '2026-08-31T13:00:00.000Z',
      subscribed: false,
      muted: true,
    };

    rerender(
      <IssueDetailPage
        issue={olderIssue}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    // State MUST STILL be CLOSED (not overwritten by older version!)
    expect(screen.getByRole('button', { name: /重新打开 Issue/ })).toBeInTheDocument();

    // Independent fields (muted, subscribed) SHOULD be merged
    expect(await screen.findByRole('button', { name: /取消静音/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /关注此 Issue/ })).toBeInTheDocument();
  });

  it('triggers markRead again when unreadCount increases from 0 to 1 while on detail page', async () => {
    const markReadSpy = vi.spyOn(tauriBridge, 'markIssueNotificationsRead').mockResolvedValue();

    const initialIssue: DesktopIssueItem = {
      ...mockIssue,
      unreadCount: 0,
    };

    const { rerender } = render(
      <IssueDetailPage
        issue={initialIssue}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        serverUrl="http://localhost:3101"
        realtimeStatus="connected"
      />,
    );

    expect(markReadSpy).not.toHaveBeenCalled();

    // New notification arrives -> unreadCount becomes 1
    await act(async () => {
      rerender(
        <IssueDetailPage
          issue={{ ...initialIssue, unreadCount: 1 }}
          onBack={vi.fn()}
          onRefresh={vi.fn()}
          serverUrl="http://localhost:3101"
          realtimeStatus="connected"
        />,
      );
    });

    expect(markReadSpy).toHaveBeenCalledWith(42);
  });
});


