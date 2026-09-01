import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { getOverviewCache, setOverviewCache } from './lib/overviewCache';
import { tauriBridge, triggerUnauthenticated } from './lib/tauri/bridge';
import type { DesktopOverviewData } from './lib/types';

const sampleOverview: DesktopOverviewData = {
  generatedAt: '2026-08-31T10:00:00.000Z',
  unreadCount: 1,
  sections: {
    assignedOpen: [
      {
        id: 101,
        title: '测试任务 #101',
        state: 'OPEN',
        bodyExcerpt: '任务详情',
        updatedAt: '2026-08-31T10:00:00.000Z',
        closedAt: null,
        relationReasons: ['ASSIGNED'],
        assignees: [{ id: 1, username: 'alex', displayName: 'Alex' }],
        labels: [],
        additionalLabelCount: 0,
        unreadCount: 1,
        subscribed: true,
        muted: false,
        latestNotification: null,
      },
    ],
    followedOpen: [],
    recentlyClosed: [],
  },
  totals: { assignedOpen: 1, followedOpen: 0, recentlyClosed: 0 },
};

describe('Desktop App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'http://localhost:3101',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
    });
  });

  it('initializes and renders overview when authenticated', async () => {
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValue({
      authenticated: true,
      user: {
        id: 1,
        username: 'alex',
        displayName: 'Alex Chen',
        email: 'alex@example.com',
        role: 'USER',
        roles: ['DEVELOPMENT'],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    });
    vi.spyOn(tauriBridge, 'getOverview').mockResolvedValue(sampleOverview);

    render(<App />);

    expect(await screen.findByText('IssueFlow')).toBeInTheDocument();
    expect(await screen.findByText('待我处理')).toBeInTheDocument();
  });

  it('triggers global auth transition to login page when non-overview command returns UNAUTHENTICATED', async () => {
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValue({
      authenticated: true,
      user: {
        id: 1,
        username: 'alex',
        displayName: 'Alex Chen',
        email: 'alex@example.com',
        role: 'USER',
        roles: ['DEVELOPMENT'],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    });
    vi.spyOn(tauriBridge, 'getOverview').mockResolvedValue(sampleOverview);

    render(<App />);

    expect(await screen.findByText('测试任务 #101')).toBeInTheDocument();

    // Trigger unauthenticated event directly
    act(() => {
      triggerUnauthenticated();
    });

    // Global auth transition redirects to AuthFlow!
    expect(await screen.findByText('IssueFlow 桌面浮窗')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /浏览器授权登录/ })).toBeInTheDocument();
  });

  it('correctly partitions cache and switches sources from server A to server B upon pairing completion', async () => {
    // Start on Server A in unauthenticated state
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValue({
      authenticated: false,
      user: null,
    });
    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'https://serverA.example.com',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
    });

    const otherServerData: DesktopOverviewData = {
      ...sampleOverview,
      sections: {
        ...sampleOverview.sections,
        assignedOpen: [
          {
            ...sampleOverview.sections.assignedOpen[0],
            id: 303,
            title: 'Other Server Unrelated Issue',
          },
        ],
      },
    };

    const serverBData: DesktopOverviewData = {
      ...sampleOverview,
      sections: {
        ...sampleOverview.sections,
        assignedOpen: [
          {
            ...sampleOverview.sections.assignedOpen[0],
            id: 202,
            title: 'Server B Dedicated Issue',
          },
        ],
      },
    };

    setOverviewCache('https://server-other.example.com', 1, otherServerData);
    setOverviewCache('https://serverB.example.com', 2, serverBData);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('IssueFlow 桌面浮窗')).toBeInTheDocument();

    // Mock pairing authorization completing with Server B
    vi.spyOn(tauriBridge, 'startPairing').mockResolvedValue({
      pairingId: 'p-1',
      userCode: 'CODE-99',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      pollIntervalSeconds: 0.05,
    });
    vi.spyOn(tauriBridge, 'pollPairingStatus').mockResolvedValue({
      status: 'AUTHORIZED',
      apiToken: {
        id: 200,
        name: 'Server B Token',
        prefix: 'ift_desk',
        kind: 'DESKTOP',
        deviceName: 'Mac',
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    // When checkAuthStatus and getAppConfig are called after pairing:
    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'https://serverB.example.com',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
    });
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValue({
      authenticated: true,
      user: {
        id: 2,
        username: 'bob',
        displayName: 'Bob B',
        email: 'bob@example.com',
        role: 'USER',
        roles: ['DEVELOPMENT'],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    });
    vi.spyOn(tauriBridge, 'getOverview').mockResolvedValue(serverBData);

    // Start pairing
    await user.click(screen.getByRole('button', { name: /浏览器授权登录/ }));

    // Wait for auth completion and overview page render
    expect(await screen.findByText('Server B Dedicated Issue', {}, { timeout: 3000 })).toBeInTheDocument();

    // Verify other server cache is untouched and Server B cache is used
    expect(
      getOverviewCache('https://server-other.example.com', 1)?.sections.assignedOpen[0].title,
    ).toBe('Other Server Unrelated Issue');
    expect(getOverviewCache('https://serverB.example.com', 2)?.sections.assignedOpen[0].title).toBe(
      'Server B Dedicated Issue',
    );
  });

  it('does not hydrate overview query or pointer cache when auth check returns unauthenticated', async () => {
    // Populate an active pointer and cached overview from previous session
    setOverviewCache('http://localhost:3101', 1, sampleOverview);

    // Initial checkAuthStatus says unauthenticated
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValue({
      authenticated: false,
      user: null,
    });

    render(<App />);

    // Screen must go directly to AuthFlow, NOT render cached overview
    expect(await screen.findByText('IssueFlow 桌面浮窗')).toBeInTheDocument();
    expect(screen.queryByText('测试任务 #101')).not.toBeInTheDocument();

    // Cache must have been cleared by transitionToUnauthenticated
    expect(getOverviewCache('http://localhost:3101', 1)).toBeNull();
  });

  it('clears only server B pointer/cache and keeps server A cache when initial config is B and auth is false', async () => {
    // Populate Server A cache and Server B cache
    setOverviewCache('https://serverA.example.com', 1, sampleOverview);
    setOverviewCache('https://serverB.example.com', 2, {
      ...sampleOverview,
      sections: {
        ...sampleOverview.sections,
        assignedOpen: [
          {
            ...sampleOverview.sections.assignedOpen[0],
            id: 202,
            title: 'Server B Issue',
          },
        ],
      },
    });

    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'https://serverB.example.com',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
    });
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValue({
      authenticated: false,
      user: null,
    });

    render(<App />);

    expect(await screen.findByText('IssueFlow 桌面浮窗')).toBeInTheDocument();

    // Server B cache must be cleared
    expect(getOverviewCache('https://serverB.example.com', 2)).toBeNull();

    // Server A cache MUST be preserved!
    expect(getOverviewCache('https://serverA.example.com', 1)).not.toBeNull();
    expect(getOverviewCache('https://serverA.example.com', 1)?.sections.assignedOpen[0].title).toBe(
      '测试任务 #101',
    );
  });

  it('preserves Server A cache and cleans only Server B when switching from Server A to Server B fails auth', async () => {
    // 1. Initial authenticated session on Server A
    setOverviewCache('https://serverA.example.com', 1, sampleOverview);
    setOverviewCache('https://serverB.example.com', 2, {
      ...sampleOverview,
      sections: {
        ...sampleOverview.sections,
        assignedOpen: [
          {
            ...sampleOverview.sections.assignedOpen[0],
            id: 202,
            title: 'Server B Issue',
          },
        ],
      },
    });

    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'https://serverA.example.com',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
    });
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValueOnce({
      authenticated: true,
      user: {
        id: 1,
        username: 'alex',
        displayName: 'Alex Chen',
        email: 'alex@example.com',
        role: 'USER',
        roles: ['DEVELOPMENT'],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    });
    vi.spyOn(tauriBridge, 'getOverview').mockResolvedValue(sampleOverview);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('测试任务 #101')).toBeInTheDocument();

    // 2. Open settings
    await user.click(screen.getByRole('button', { name: /偏好设置/ }));
    expect(await screen.findByText('偏好设置')).toBeInTheDocument();

    // 3. User changes serverUrl to server B and saves
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(tauriBridge, 'updateAppConfig').mockResolvedValue({
      serverUrl: 'https://serverB.example.com',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
    });
    // Check auth on server B fails (no token)
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValueOnce({
      authenticated: false,
      user: null,
    });

    const serverInput = screen.getByLabelText(/服务连接地址/);
    await user.clear(serverInput);
    await user.type(serverInput, 'https://serverB.example.com');
    await user.click(screen.getByRole('button', { name: /保存/ }));

    // Must transition to login page
    expect(await screen.findByText('IssueFlow 桌面浮窗')).toBeInTheDocument();

    // Server B cache must be cleared
    expect(getOverviewCache('https://serverB.example.com', 2)).toBeNull();

    // Server A cache MUST be preserved intact!
    expect(getOverviewCache('https://serverA.example.com', 1)).not.toBeNull();
    expect(getOverviewCache('https://serverA.example.com', 1)?.sections.assignedOpen[0].title).toBe(
      '测试任务 #101',
    );
  });

  it('preserves Server B session and cache without switching to login when late REST 401 arrives from Server A', async () => {
    // 1. Seed both Server A and Server B caches
    setOverviewCache('https://serverA.example.com', 1, sampleOverview);
    const serverBData: DesktopOverviewData = {
      ...sampleOverview,
      sections: {
        ...sampleOverview.sections,
        assignedOpen: [
          {
            ...sampleOverview.sections.assignedOpen[0],
            id: 202,
            title: 'Server B Issue #202',
          },
        ],
      },
    };
    setOverviewCache('https://serverB.example.com', 2, serverBData);

    // 2. Start app connected to Server B
    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'https://serverB.example.com',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
    });
    vi.spyOn(tauriBridge, 'checkAuthStatus').mockResolvedValue({
      authenticated: true,
      user: {
        id: 2,
        username: 'bob',
        displayName: 'Bob Lin',
        email: 'bob@example.com',
        role: 'USER',
        roles: ['DEVELOPMENT'],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    });
    vi.spyOn(tauriBridge, 'getOverview').mockResolvedValue(serverBData);

    render(<App />);

    expect(await screen.findByText('Server B Issue #202')).toBeInTheDocument();

    // 3. Late REST 401 arrives from Server A (origin carries Server A)
    act(() => {
      triggerUnauthenticated({ origin: 'https://serverA.example.com' });
    });

    // 4. Assert: Still on Server B overview page, NOT switched to login/AuthFlow
    expect(screen.getByText('Server B Issue #202')).toBeInTheDocument();
    expect(screen.queryByText('IssueFlow 桌面浮窗')).not.toBeInTheDocument();

    // 5. Assert: Server B cache is completely preserved; Server A cache is cleared
    expect(getOverviewCache('https://serverB.example.com', 2)).not.toBeNull();
    expect(getOverviewCache('https://serverB.example.com', 2)?.sections.assignedOpen[0].title).toBe(
      'Server B Issue #202',
    );
    expect(getOverviewCache('https://serverA.example.com', 1)).toBeNull();
  });
});

