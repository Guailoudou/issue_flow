import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOverviewCache,
  getActiveUserPointer,
  getOverviewCache,
  normalizeOriginKey,
  setActiveUserPointer,
  setOverviewCache,
} from './overviewCache';
import type { DesktopOverviewData } from './types';

function createSampleOverview(userId: number, customTitle?: string): DesktopOverviewData {
  return {
    generatedAt: new Date('2026-08-31T10:00:00Z').toISOString(),
    unreadCount: 1,
    sections: {
      assignedOpen: [
        {
          id: 100 + userId,
          title: customTitle || `User ${userId} Assigned Issue`,
          state: 'OPEN',
          bodyExcerpt: 'Body excerpt text',
          updatedAt: '2026-08-31T10:00:00.000Z',
          closedAt: null,
          relationReasons: ['ASSIGNED'],
          assignees: [{ id: userId, username: `user${userId}`, displayName: `User ${userId}` }],
          labels: [{ id: 1, name: '桌面端', color: '0D9488' }],
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
    totals: {
      assignedOpen: 1,
      followedOpen: 0,
      recentlyClosed: 0,
    },
  };
}

describe('overviewCache partitioning and validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('normalizes server URL to canonical origin', () => {
    expect(normalizeOriginKey('https://issueflow.example.com/')).toBe(
      'https://issueflow.example.com',
    );
    expect(normalizeOriginKey('https://ISSUEFLOW.EXAMPLE.COM:443/api/')).toBe(
      'https://issueflow.example.com',
    );
    expect(normalizeOriginKey('http://localhost:3101/sub/')).toBe('http://localhost:3101');
  });

  it('isolates User A and User B cache on the same server origin', () => {
    const serverUrl = 'http://localhost:3101';
    const userAData = createSampleOverview(1, 'User A Secret Data');
    const userBData = createSampleOverview(2, 'User B Secret Data');

    setOverviewCache(serverUrl, 1, userAData);
    setOverviewCache(serverUrl, 2, userBData);

    const cachedUserA = getOverviewCache(serverUrl, 1);
    const cachedUserB = getOverviewCache(serverUrl, 2);

    expect(cachedUserA?.sections.assignedOpen[0].title).toBe('User A Secret Data');
    expect(cachedUserB?.sections.assignedOpen[0].title).toBe('User B Secret Data');
  });

  it('isolates caches across different server origins for the same user ID', () => {
    const server1 = 'https://server1.example.com';
    const server2 = 'https://server2.example.com';
    const data1 = createSampleOverview(1, 'Server 1 Data');
    const data2 = createSampleOverview(1, 'Server 2 Data');

    setOverviewCache(server1, 1, data1);
    setOverviewCache(server2, 1, data2);

    expect(getOverviewCache(server1, 1)?.sections.assignedOpen[0].title).toBe('Server 1 Data');
    expect(getOverviewCache(server2, 1)?.sections.assignedOpen[0].title).toBe('Server 2 Data');
  });

  it('uses active user pointer during cold start when userId is not yet known', () => {
    const serverUrl = 'http://localhost:3101';
    const userAData = createSampleOverview(42, 'User 42 Offline Cache');

    setOverviewCache(serverUrl, 42, userAData);
    expect(getActiveUserPointer(serverUrl)).toBe(42);

    // Call getOverviewCache without explicit userId (e.g. cold start with token but null user)
    const fallbackCache = getOverviewCache(serverUrl);
    expect(fallbackCache?.sections.assignedOpen[0].title).toBe('User 42 Offline Cache');
  });

  it('logout clears active user cache and pointer without affecting other origins', () => {
    const serverA = 'https://serverA.example.com';
    const serverB = 'https://serverB.example.com';

    setOverviewCache(serverA, 10, createSampleOverview(10, 'Server A Data'));
    setOverviewCache(serverB, 20, createSampleOverview(20, 'Server B Data'));

    expect(getOverviewCache(serverA, 10)).not.toBeNull();
    expect(getOverviewCache(serverB, 20)).not.toBeNull();

    // Logout from server A
    clearOverviewCache(serverA, 10);

    expect(getOverviewCache(serverA, 10)).toBeNull();
    expect(getActiveUserPointer(serverA)).toBeNull();

    // Server B data remains untouched
    expect(getOverviewCache(serverB, 20)?.sections.assignedOpen[0].title).toBe('Server B Data');
    expect(getActiveUserPointer(serverB)).toBe(20);
  });

  it('strips unknown or sensitive fields before writing to localStorage', () => {
    const serverUrl = 'http://localhost:3101';
    const dirtyData = {
      ...createSampleOverview(1),
      sensitiveAdminToken: 'SECRET_TOKEN_12345',
      unknownExtraField: 'DO_NOT_PERSIST',
    };

    setOverviewCache(serverUrl, 1, dirtyData);

    const rawStored = localStorage.getItem(`issueflow_desktop_overview:http://localhost:3101:1`);
    expect(rawStored).not.toBeNull();
    expect(rawStored).not.toContain('sensitiveAdminToken');
    expect(rawStored).not.toContain('SECRET_TOKEN_12345');
    expect(rawStored).not.toContain('unknownExtraField');
  });

  it('enforces maximum 50 items per section and ignores payload exceeding size limit', () => {
    const serverUrl = 'http://localhost:3101';
    const sample = createSampleOverview(1);
    const largeAssigned = Array.from({ length: 60 }, (_, i) => ({
      ...sample.sections.assignedOpen[0],
      id: 2000 + i,
      title: `Issue #${i}`,
    }));

    const bigData: DesktopOverviewData = {
      ...sample,
      sections: {
        ...sample.sections,
        assignedOpen: largeAssigned,
      },
    };

    setOverviewCache(serverUrl, 1, bigData);

    const stored = getOverviewCache(serverUrl, 1);
    expect(stored?.sections.assignedOpen.length).toBe(50);
  });

  it('rejects and drops payloads exceeding 512KB from being written to localStorage while passing shared schema', async () => {
    const { desktopOverviewSchema } = await import('@issueflow/shared');
    const serverUrl = 'http://localhost:3101';

    // Construct valid shared schema items:
    // 3 sections * 50 items = 150 items
    // Each item has valid bodyExcerpt <= 2000, latestNotification.message <= 10000, valid assignees
    const createValidItem = (id: number) => ({
      id,
      title: `Valid Issue #${id} with thorough description`,
      state: 'OPEN' as const,
      bodyExcerpt: 'A'.repeat(2000), // Max valid length 2000
      updatedAt: '2026-08-31T10:00:00.000Z',
      closedAt: null,
      relationReasons: ['ASSIGNED' as const],
      assignees: [
        { id: 1, username: 'user1', displayName: 'User One' },
        { id: 2, username: 'user2', displayName: 'User Two' },
      ],
      labels: [
        { id: 1, name: '桌面端', color: '0D9488' },
        { id: 2, name: '高优先级', color: 'EF4444' },
      ],
      additionalLabelCount: 0,
      unreadCount: 1,
      subscribed: true,
      muted: false,
      latestNotification: {
        id: 1000 + id,
        issueId: id,
        type: 'ASSIGNED' as const,
        message: 'M'.repeat(5000), // Valid length <= 10000
        createdAt: '2026-08-31T10:00:00.000Z',
        readAt: null,
      },
    });

    const assigned50 = Array.from({ length: 50 }, (_, i) => createValidItem(1000 + i));
    const followed50 = Array.from({ length: 50 }, (_, i) => createValidItem(2000 + i));
    const closed50 = Array.from({ length: 50 }, (_, i) => ({
      ...createValidItem(3000 + i),
      state: 'CLOSED' as const,
      closedAt: '2026-08-31T10:30:00.000Z',
    }));

    const oversizedData: DesktopOverviewData = {
      generatedAt: '2026-08-31T10:00:00.000Z',
      unreadCount: 150,
      sections: {
        assignedOpen: assigned50,
        followedOpen: followed50,
        recentlyClosed: closed50,
      },
      totals: {
        assignedOpen: 50,
        followedOpen: 50,
        recentlyClosed: 50,
      },
    };

    // 1. Assert desktopOverviewSchema.parse succeeds
    expect(() => desktopOverviewSchema.parse(oversizedData)).not.toThrow();

    // 2. Assert serialized byte size > 512KB
    const serializedBytes = new TextEncoder().encode(JSON.stringify(oversizedData)).length;
    expect(serializedBytes).toBeGreaterThan(512 * 1024);

    // 3. Set overview cache and assert NOT written to localStorage
    setOverviewCache(serverUrl, 1, oversizedData);

    const rawStored = localStorage.getItem(`issueflow_desktop_overview:http://localhost:3101:1`);
    expect(rawStored).toBeNull();
    expect(getOverviewCache(serverUrl, 1)).toBeNull();
  });
});

