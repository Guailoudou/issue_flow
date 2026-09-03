import type {
  AppConfig,
  AuthStatusResponse,
  DesktopOverviewData,
  DesktopPreferenceData,
  IssueStateUpdateResult,
  PublicPairingCreateResponse,
  PublicPairingExchangeResult,
  RealtimeEvent,
  RealtimeEventEnvelope,
  RealtimeStatus,
  RealtimeStatusEnvelope,
  UpdateDesktopPreferencePayload,
} from '../types';

let isTauriEnv = false;
try {
  isTauriEnv = Boolean(
    typeof window !== 'undefined' &&
      ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
        (window as unknown as { __TAURI__?: unknown }).__TAURI__),
  );
} catch {
  isTauriEnv = false;
}

// In-memory mock state for dev/testing in browser
let mockConfig: AppConfig = {
  serverUrl: 'http://localhost:3101',
  globalShortcut: 'Alt+CommandOrControl+I',
  launchAtLogin: false,
  pinned: false,
  edgeSnapEnabled: true,
};

let mockAuthenticated = true;
let mockUnreadCount = 2;

export interface UnauthenticatedEventDetail {
  origin?: string;
}

export function parseUnauthenticatedError(err: unknown): {
  isUnauthenticated: boolean;
  origin?: string;
} {
  if (!err) return { isUnauthenticated: false };
  let str = '';
  if (typeof err === 'string') {
    str = err.trim();
  } else if (err instanceof Error) {
    str = err.message.trim();
  } else if (typeof err === 'object') {
    const obj = err as { code?: unknown; message?: unknown; origin?: unknown };
    if (obj.code === 'UNAUTHENTICATED' || obj.message === 'UNAUTHENTICATED') {
      return {
        isUnauthenticated: true,
        origin: typeof obj.origin === 'string' ? obj.origin : undefined,
      };
    }
    if (typeof obj.message === 'string') {
      str = obj.message.trim();
    }
  }

  if (str === 'UNAUTHENTICATED') {
    return { isUnauthenticated: true };
  }
  if (str.startsWith('UNAUTHENTICATED:')) {
    const origin = str.slice('UNAUTHENTICATED:'.length).trim();
    return { isUnauthenticated: true, origin: origin || undefined };
  }
  return { isUnauthenticated: false };
}

export function isUnauthenticatedError(err: unknown): boolean {
  return parseUnauthenticatedError(err).isUnauthenticated;
}

export type AuthTransitionCallback = (detail?: UnauthenticatedEventDetail) => void;
const unauthenticatedListeners = new Set<AuthTransitionCallback>();

export function onUnauthenticated(callback: AuthTransitionCallback): () => void {
  unauthenticatedListeners.add(callback);
  return () => {
    unauthenticatedListeners.delete(callback);
  };
}

export function triggerUnauthenticated(detail?: UnauthenticatedEventDetail): void {
  unauthenticatedListeners.forEach((listener) => {
    try {
      listener(detail);
    } catch {
      // Ignore callback errors
    }
  });
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    const parsed = parseUnauthenticatedError(err);
    if (parsed.isUnauthenticated) {
      triggerUnauthenticated(parsed.origin ? { origin: parsed.origin } : undefined);
    }
    throw err;
  }
}

export const tauriBridge = {
  async startWindowDrag(): Promise<void> {
    if (!isTauriEnv) return;
    return await invokeTauri<void>('start_window_drag');
  },

  async snapWindowToNearestEdge(): Promise<void> {
    if (!isTauriEnv) return;
    return await invokeTauri<void>('snap_window_to_nearest_edge');
  },

  async reconnectRealtime(): Promise<void> {
    if (!isTauriEnv) return;
    return await invokeTauri<void>('reconnect_realtime');
  },

  async checkAuthStatus(): Promise<AuthStatusResponse> {
    if (!isTauriEnv) {
      return {
        authenticated: mockAuthenticated,
        user: mockAuthenticated
          ? {
              id: 1,
              username: 'alex',
              displayName: 'Alex Chen',
              email: 'alex@example.com',
              role: 'USER',
              roles: ['DEVELOPMENT'],
              active: true,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            }
          : null,
      };
    }
    return await invokeTauri<AuthStatusResponse>('check_auth_status');
  },

  async startPairing(
    serverUrl?: string,
    deviceName?: string,
  ): Promise<PublicPairingCreateResponse> {
    if (!isTauriEnv) {
      return {
        pairingId: 'mock-pairing-id-1234',
        userCode: 'FLOW-8823',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        pollIntervalSeconds: 3,
      };
    }
    return await invokeTauri<PublicPairingCreateResponse>('start_pairing', {
      serverUrl,
      deviceName,
    });
  },

  async pollPairingStatus(): Promise<PublicPairingExchangeResult> {
    if (!isTauriEnv) {
      mockAuthenticated = true;
      return {
        status: 'AUTHORIZED',
        apiToken: {
          id: 101,
          name: 'IssueFlow Desktop · MacBook Pro',
          prefix: 'ift_desk',
          kind: 'DESKTOP',
          deviceName: 'MacBook Pro',
          expiresAt: null,
          createdAt: new Date().toISOString(),
        },
      };
    }
    return await invokeTauri<PublicPairingExchangeResult>('poll_pairing_status');
  },

  async cancelPairing(pairingId?: string): Promise<void> {
    if (!isTauriEnv) return;
    return await invokeTauri<void>('cancel_pairing', { pairingId: pairingId ?? null });
  },

  async reopenPairingAuthorization(): Promise<void> {
    if (!isTauriEnv) {
      window.open('http://localhost:5173/desktop/authorize?code=FLOW-8823', '_blank');
      return;
    }
    return await invokeTauri<void>('reopen_pairing_authorization');
  },

  async logout(): Promise<void> {
    if (!isTauriEnv) {
      mockAuthenticated = false;
      return;
    }
    return await invokeTauri<void>('logout');
  },

  async getOverview(closedDays?: number): Promise<DesktopOverviewData> {
    if (!isTauriEnv) {
      return {
        generatedAt: new Date().toISOString(),
        unreadCount: mockUnreadCount,
        sections: {
          assignedOpen: [
            {
              id: 42,
              title: '修复 macOS 浮窗断网重连后未读状态未刷新的问题',
              state: 'OPEN',
              bodyExcerpt:
                '在网络恢复或 WebSocket 断开重连时，客户端应自动触发 Overview 全量快照更新并回放实时事件。',
              updatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
              closedAt: null,
              relationReasons: ['ASSIGNED', 'MENTIONED'],
              assignees: [{ id: 1, username: 'alex', displayName: 'Alex Chen' }],
              labels: [{ id: 1, name: '桌面端', color: '0D9488' }],
              additionalLabelCount: 0,
              unreadCount: 1,
              subscribed: true,
              muted: false,
              latestNotification: {
                id: 99,
                issueId: 42,
                type: 'MENTIONED',
                message: '@alex 请确认一下重连退避算法的时间间隔',
                readAt: null,
                createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
              },
            },
          ],
          followedOpen: [
            {
              id: 38,
              title: '云效 Webhook 同步状态字段冲突优化',
              state: 'OPEN',
              bodyExcerpt: '针对外部代码平台关联 commit/MR 时的状态自动流转进行幂等保护。',
              updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
              closedAt: null,
              relationReasons: ['FOLLOWING'],
              assignees: [{ id: 2, username: 'bob', displayName: 'Bob Lin' }],
              labels: [
                { id: 2, name: 'Webhook', color: 'EA580C' },
                { id: 3, name: '后端', color: '64748B' },
              ],
              additionalLabelCount: 1,
              unreadCount: 0,
              subscribed: true,
              muted: false,
              latestNotification: null,
            },
          ],
          recentlyClosed: [
            {
              id: 35,
              title: '支持免打扰时间段与单 Issue 静音',
              state: 'CLOSED',
              bodyExcerpt: '用户可在设置中开启免打扰模式，或针对特定 Issue 开启静音。',
              updatedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
              closedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
              relationReasons: ['ASSIGNED'],
              assignees: [{ id: 1, username: 'alex', displayName: 'Alex Chen' }],
              labels: [{ id: 1, name: '桌面端', color: '0D9488' }],
              additionalLabelCount: 0,
              unreadCount: 0,
              subscribed: true,
              muted: false,
              latestNotification: null,
            },
          ],
        },
        totals: {
          assignedOpen: 1,
          followedOpen: 1,
          recentlyClosed: 1,
        },
      };
    }
    return await invokeTauri<DesktopOverviewData>('get_overview', { closedDays });
  },

  async updateIssueState(
    issueId: number,
    state: 'OPEN' | 'CLOSED',
    updatedAt: string,
  ): Promise<IssueStateUpdateResult> {
    if (!isTauriEnv) {
      return {
        id: issueId,
        state,
        updatedAt: new Date().toISOString(),
        closedAt: state === 'CLOSED' ? new Date().toISOString() : null,
      };
    }
    return await invokeTauri<IssueStateUpdateResult>('update_issue_state', {
      issueId,
      state,
      updatedAt,
    });
  },

  async setIssueSubscription(issueId: number, subscribed: boolean): Promise<void> {
    if (!isTauriEnv) return;
    return await invokeTauri<void>('set_issue_subscription', { issueId, subscribed });
  },

  async setIssueMute(issueId: number, muted: boolean): Promise<void> {
    if (!isTauriEnv) return;
    return await invokeTauri<void>('set_issue_mute', { issueId, muted });
  },

  async markIssueNotificationsRead(issueId: number): Promise<void> {
    if (!isTauriEnv) {
      mockUnreadCount = Math.max(0, mockUnreadCount - 1);
      return;
    }
    return await invokeTauri<void>('mark_issue_notifications_read', { issueId });
  },

  async getDesktopPreferences(): Promise<DesktopPreferenceData> {
    if (!isTauriEnv) {
      return {
        systemNotificationsEnabled: true,
        assignmentNotificationsEnabled: true,
        mentionNotificationsEnabled: true,
        statusNotificationsEnabled: true,
        assigneeNotificationsEnabled: true,
        commentNotificationsEnabled: false,
        doNotDisturbEnabled: false,
        doNotDisturbStart: '22:00',
        doNotDisturbEnd: '08:00',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        recentlyClosedDays: 7,
        updatedAt: new Date().toISOString(),
      };
    }
    return await invokeTauri<DesktopPreferenceData>('get_desktop_preferences');
  },

  async updateDesktopPreferences(
    payload: UpdateDesktopPreferencePayload,
  ): Promise<DesktopPreferenceData> {
    if (!isTauriEnv) {
      return {
        systemNotificationsEnabled: payload.systemNotificationsEnabled ?? true,
        assignmentNotificationsEnabled: payload.assignmentNotificationsEnabled ?? true,
        mentionNotificationsEnabled: payload.mentionNotificationsEnabled ?? true,
        statusNotificationsEnabled: payload.statusNotificationsEnabled ?? true,
        assigneeNotificationsEnabled: payload.assigneeNotificationsEnabled ?? true,
        commentNotificationsEnabled: payload.commentNotificationsEnabled ?? false,
        doNotDisturbEnabled: payload.doNotDisturbEnabled ?? false,
        doNotDisturbStart: payload.doNotDisturbStart ?? '22:00',
        doNotDisturbEnd: payload.doNotDisturbEnd ?? '08:00',
        timeZone: payload.timeZone || 'Asia/Shanghai',
        recentlyClosedDays: payload.recentlyClosedDays ?? 7,
        updatedAt: new Date().toISOString(),
      };
    }
    return await invokeTauri<DesktopPreferenceData>('update_desktop_preferences', { payload });
  },

  async getAppConfig(): Promise<AppConfig> {
    if (!isTauriEnv) return mockConfig;
    return await invokeTauri<AppConfig>('get_app_config');
  },

  async updateAppConfig(config: AppConfig): Promise<AppConfig> {
    if (!isTauriEnv) {
      mockConfig = { ...config };
      return mockConfig;
    }
    return await invokeTauri<AppConfig>('update_app_config', { newConfig: config });
  },

  async setWindowPinned(pinned: boolean): Promise<void> {
    if (!isTauriEnv) {
      mockConfig.pinned = pinned;
      return;
    }
    return await invokeTauri<void>('set_window_pinned', { pinned });
  },

  async hideWindow(): Promise<void> {
    if (!isTauriEnv) return;
    return await invokeTauri<void>('hide_window');
  },

  async setFocusedIssue(issueId: number | null): Promise<void> {
    if (!isTauriEnv) return;
    return await invokeTauri<void>('set_focused_issue', { issueId });
  },

  async openMainSite(issueId?: number): Promise<void> {
    if (!isTauriEnv) {
      const url = issueId
        ? `http://localhost:5173/issues/${issueId}`
        : 'http://localhost:5173/issues';
      window.open(url, '_blank');
      return;
    }
    return await invokeTauri<void>('open_main_site', { issueId: issueId ?? null });
  },

  async listenRealtimeEvent(
    callback: (envelope: RealtimeEventEnvelope) => void,
  ): Promise<() => void> {
    if (!isTauriEnv) return () => {};
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<RealtimeEventEnvelope>('realtime:event', (ev) =>
      callback(ev.payload),
    );
    return unlisten;
  },

  async listenRealtimeStatus(
    callback: (envelope: RealtimeStatusEnvelope) => void,
  ): Promise<() => void> {
    if (!isTauriEnv) {
      callback({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        status: 'connected',
      });
      return () => {};
    }
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<RealtimeStatusEnvelope>('realtime:status', (ev) =>
      callback(ev.payload),
    );
    return unlisten;
  },

  async listenNavigate(callback: (page: string) => void): Promise<() => void> {
    if (!isTauriEnv) return () => {};
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<string>('desktop:navigate', (ev) => callback(ev.payload));
    return unlisten;
  },

  async getRealtimeStatus(): Promise<RealtimeStatusEnvelope> {
    if (!isTauriEnv) {
      return {
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        status: 'connected',
      };
    }
    return await invokeTauri<RealtimeStatusEnvelope>('get_realtime_status');
  },
};
