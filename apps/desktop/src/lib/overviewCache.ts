import { desktopOverviewSchema } from '@issueflow/shared';
import type { DesktopOverviewData } from './types';

const CACHE_PREFIX = 'issueflow_desktop_overview:';
const ACTIVE_USER_PREFIX = 'issueflow_desktop_active_user:';
const MAX_ITEMS_PER_SECTION = 50;
const MAX_BYTE_LENGTH = 512 * 1024; // 512 KB

export function normalizeOriginKey(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

export function getActiveUserPointer(serverUrl: string): number | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const origin = normalizeOriginKey(serverUrl);
  if (!origin) return null;
  const key = `${ACTIVE_USER_PREFIX}${origin}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const num = Number(raw);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

export function setActiveUserPointer(serverUrl: string, userId: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const origin = normalizeOriginKey(serverUrl);
  if (!origin || !Number.isSafeInteger(userId) || userId <= 0) return;
  const key = `${ACTIVE_USER_PREFIX}${origin}`;
  try {
    localStorage.setItem(key, String(userId));
  } catch {
    // Ignore quota errors
  }
}

export function clearActiveUserPointer(serverUrl: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const origin = normalizeOriginKey(serverUrl);
  if (!origin) return;
  const key = `${ACTIVE_USER_PREFIX}${origin}`;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

export function getOverviewCache(
  serverUrl: string,
  userId?: number | null,
): DesktopOverviewData | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const origin = normalizeOriginKey(serverUrl);
  if (!origin) return null;

  let targetUserId = userId;
  if (!targetUserId || targetUserId <= 0) {
    targetUserId = getActiveUserPointer(serverUrl);
  }
  if (!targetUserId || targetUserId <= 0) {
    return null;
  }

  const key = `${CACHE_PREFIX}${origin}:${targetUserId}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const validated = desktopOverviewSchema.safeParse(parsed);
    if (!validated.success) {
      localStorage.removeItem(key);
      return null;
    }
    return validated.data as DesktopOverviewData;
  } catch {
    return null;
  }
}

export function setOverviewCache(serverUrl: string, userId: number, data: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const origin = normalizeOriginKey(serverUrl);
  if (!origin || !Number.isSafeInteger(userId) || userId <= 0) return;

  try {
    const rawObj = (data && typeof data === 'object' ? data : {}) as {
      generatedAt?: string;
      unreadCount?: number;
      sections?: {
        assignedOpen?: unknown[];
        followedOpen?: unknown[];
        recentlyClosed?: unknown[];
      };
      totals?: {
        assignedOpen?: number;
        followedOpen?: number;
        recentlyClosed?: number;
      };
    };

    const trimmed = {
      generatedAt: rawObj.generatedAt,
      unreadCount: rawObj.unreadCount,
      sections: {
        assignedOpen: Array.isArray(rawObj.sections?.assignedOpen)
          ? rawObj.sections.assignedOpen.slice(0, MAX_ITEMS_PER_SECTION)
          : [],
        followedOpen: Array.isArray(rawObj.sections?.followedOpen)
          ? rawObj.sections.followedOpen.slice(0, MAX_ITEMS_PER_SECTION)
          : [],
        recentlyClosed: Array.isArray(rawObj.sections?.recentlyClosed)
          ? rawObj.sections.recentlyClosed.slice(0, MAX_ITEMS_PER_SECTION)
          : [],
      },
      totals: rawObj.totals,
    };

    // Parse strictly with shared schema to validate structure and types
    const parsed = desktopOverviewSchema.parse(trimmed);

    // Deep sanitize & strip unknown fields
    const sanitized: DesktopOverviewData = {
      generatedAt: parsed.generatedAt,
      unreadCount: parsed.unreadCount,
      sections: {
        assignedOpen: parsed.sections.assignedOpen.map((item) => ({
          id: item.id,
          title: item.title,
          state: item.state,
          bodyExcerpt: item.bodyExcerpt,
          updatedAt: item.updatedAt,
          closedAt: item.closedAt,
          relationReasons: [...item.relationReasons],
          assignees: item.assignees.map((u) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName,
          })),
          labels: item.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
          additionalLabelCount: item.additionalLabelCount,
          unreadCount: item.unreadCount,
          subscribed: item.subscribed,
          muted: item.muted,
          latestNotification: item.latestNotification
            ? {
                id: item.latestNotification.id,
                issueId: item.latestNotification.issueId,
                type: item.latestNotification.type,
                message: item.latestNotification.message,
                readAt: item.latestNotification.readAt,
                createdAt: item.latestNotification.createdAt,
              }
            : null,
        })),
        followedOpen: parsed.sections.followedOpen.map((item) => ({
          id: item.id,
          title: item.title,
          state: item.state,
          bodyExcerpt: item.bodyExcerpt,
          updatedAt: item.updatedAt,
          closedAt: item.closedAt,
          relationReasons: [...item.relationReasons],
          assignees: item.assignees.map((u) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName,
          })),
          labels: item.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
          additionalLabelCount: item.additionalLabelCount,
          unreadCount: item.unreadCount,
          subscribed: item.subscribed,
          muted: item.muted,
          latestNotification: item.latestNotification
            ? {
                id: item.latestNotification.id,
                issueId: item.latestNotification.issueId,
                type: item.latestNotification.type,
                message: item.latestNotification.message,
                readAt: item.latestNotification.readAt,
                createdAt: item.latestNotification.createdAt,
              }
            : null,
        })),
        recentlyClosed: parsed.sections.recentlyClosed.map((item) => ({
          id: item.id,
          title: item.title,
          state: item.state,
          bodyExcerpt: item.bodyExcerpt,
          updatedAt: item.updatedAt,
          closedAt: item.closedAt,
          relationReasons: [...item.relationReasons],
          assignees: item.assignees.map((u) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName,
          })),
          labels: item.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
          additionalLabelCount: item.additionalLabelCount,
          unreadCount: item.unreadCount,
          subscribed: item.subscribed,
          muted: item.muted,
          latestNotification: item.latestNotification
            ? {
                id: item.latestNotification.id,
                issueId: item.latestNotification.issueId,
                type: item.latestNotification.type,
                message: item.latestNotification.message,
                readAt: item.latestNotification.readAt,
                createdAt: item.latestNotification.createdAt,
              }
            : null,
        })),
      },
      totals: {
        assignedOpen: parsed.totals.assignedOpen,
        followedOpen: parsed.totals.followedOpen,
        recentlyClosed: parsed.totals.recentlyClosed,
      },
    };

    const serialized = JSON.stringify(sanitized);
    if (new Blob([serialized]).size > MAX_BYTE_LENGTH) {
      return;
    }

    const key = `${CACHE_PREFIX}${origin}:${userId}`;
    localStorage.setItem(key, serialized);
    setActiveUserPointer(serverUrl, userId);
  } catch {
    // Validation failure or storage quota exceeded, silently drop
  }
}

export function clearOverviewCache(serverUrl: string, userId?: number | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const origin = normalizeOriginKey(serverUrl);
  if (!origin) return;

  const targetUserId = userId && userId > 0 ? userId : getActiveUserPointer(serverUrl);
  if (targetUserId && targetUserId > 0) {
    const key = `${CACHE_PREFIX}${origin}:${targetUserId}`;
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore
    }
  }
  clearActiveUserPointer(serverUrl);
}
