import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeSync } from './useRealtimeSync';
import { tauriBridge } from '../../lib/tauri/bridge';
import type {
  DesktopOverviewData,
  RealtimeEvent,
  RealtimeEventEnvelope,
  RealtimeStatusEnvelope,
} from '../../lib/types';

describe('useRealtimeSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to realtime events and invalidates query cache with partition key', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () => useRealtimeSync('http://localhost:3101', 1, false),
      { wrapper },
    );

    // Initial connection envelope
    await act(async () => {
      capturedStatusHandler!({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        status: 'connected',
      });
    });

    expect(result.current.realtimeStatus).toBe('connected');

    // Trigger an issue.changed event envelope
    capturedEventHandler!({
      origin: 'http://localhost:3101',
      userId: 1,
      generation: 1,
      event: {
        type: 'issue.changed',
        issueId: 42,
        updatedAt: new Date().toISOString(),
        actorId: 1,
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['desktop-overview', 'http://localhost:3101', 1],
    });
  });

  it('deduplicates notification.created events by id', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useRealtimeSync('http://localhost:3101', 1, false), { wrapper });

    await act(async () => {
      capturedStatusHandler!({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        status: 'connected',
      });
    });

    const notifEnvelope: RealtimeEventEnvelope = {
      origin: 'http://localhost:3101',
      userId: 1,
      generation: 1,
      event: {
        type: 'notification.created',
        notification: {
          id: 777,
          issueId: 10,
          type: 'ASSIGNED',
          message: 'New assignment',
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      },
    };

    // First time -> invalidates
    capturedEventHandler!(notifEnvelope);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    // Duplicate time -> dropped
    capturedEventHandler!(notifEnvelope);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('drops out-of-order issue.changed with older updatedAt', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    const queryClient = new QueryClient();
    const serverUrl = 'http://localhost:3101';
    const userId = 1;

    const mockOverview: DesktopOverviewData = {
      generatedAt: '2026-08-31T12:00:00Z',
      unreadCount: 1,
      sections: {
        assignedOpen: [
          {
            id: 10,
            title: 'Task 10',
            state: 'OPEN',
            updatedAt: '2026-08-31T12:00:00Z',
            closedAt: null,
            unreadCount: 0,
            muted: false,
            subscribed: true,
            relationReasons: ['ASSIGNED'],
            labels: [],
            additionalLabelCount: 0,
            assignees: [],
            bodyExcerpt: '',
            latestNotification: null,
          },
        ],
        followedOpen: [],
        recentlyClosed: [],
      },
      totals: { assignedOpen: 1, followedOpen: 0, recentlyClosed: 0 },
    };
    queryClient.setQueryData(['desktop-overview', serverUrl, userId], mockOverview);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue([] as any);

    renderHook(() => useRealtimeSync(serverUrl, userId, false), { wrapper });

    await act(async () => {
      capturedStatusHandler!({
        origin: serverUrl,
        userId: 1,
        generation: 1,
        status: 'connected',
      });
    });

    // Send first event at 12:00:00Z
    act(() => {
      capturedEventHandler!({
        origin: serverUrl,
        userId: 1,
        generation: 1,
        event: {
          type: 'issue.changed',
          issueId: 10,
          updatedAt: '2026-08-31T12:00:00Z',
          actorId: 2,
        },
      });
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    invalidateSpy.mockClear();

    // Send older event (11:00:00Z) -> MUST be dropped
    capturedEventHandler!({
      origin: serverUrl,
      userId: 1,
      generation: 1,
      event: {
        type: 'issue.changed',
        issueId: 10,
        updatedAt: '2026-08-31T11:00:00Z',
        actorId: 2,
      },
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Send newer event (13:00:00Z) -> MUST invalidate
    capturedEventHandler!({
      origin: serverUrl,
      userId: 1,
      generation: 1,
      event: {
        type: 'issue.changed',
        issueId: 10,
        updatedAt: '2026-08-31T13:00:00Z',
        actorId: 2,
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['desktop-overview', serverUrl, userId],
    });
  });

  it('buffers events during snapshot fetch and flushes after completion', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    // Render with isSnapshotFetching = true
    const { rerender } = renderHook(
      ({ fetching }) => useRealtimeSync('http://localhost:3101', 1, fetching),
      {
        wrapper,
        initialProps: { fetching: true },
      },
    );

    await act(async () => {
      capturedStatusHandler!({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        status: 'connected',
      });
    });

    // Event arrives while snapshot is fetching -> buffered, NO immediate invalidation
    capturedEventHandler!({
      origin: 'http://localhost:3101',
      userId: 1,
      generation: 1,
      event: {
        type: 'issue.changed',
        issueId: 99,
        updatedAt: new Date().toISOString(),
        actorId: 1,
      },
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Snapshot fetch completes (fetching -> false)
    act(() => {
      rerender({ fetching: false });
    });

    // Buffered event flushed
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['desktop-overview', 'http://localhost:3101', 1],
    });
  });

  it('updates cached muted state when notification-mute.changed arrives', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    const queryClient = new QueryClient();
    const serverUrl = 'http://localhost:3101';
    const userId = 1;

    const mockOverview: DesktopOverviewData = {
      generatedAt: '2026-08-31T12:00:00Z',
      unreadCount: 1,
      sections: {
        assignedOpen: [
          {
            id: 88,
            title: 'Task 88',
            state: 'OPEN',
            updatedAt: '2026-08-31T12:00:00Z',
            closedAt: null,
            unreadCount: 0,
            muted: false,
            subscribed: true,
            relationReasons: ['ASSIGNED'],
            labels: [],
            additionalLabelCount: 0,
            assignees: [],
            bodyExcerpt: '',
            latestNotification: null,
          },
        ],
        followedOpen: [],
        recentlyClosed: [],
      },
      totals: { assignedOpen: 1, followedOpen: 0, recentlyClosed: 0 },
    };
    queryClient.setQueryData(['desktop-overview', serverUrl, userId], mockOverview);
    vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue([] as any);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useRealtimeSync(serverUrl, userId, false), { wrapper });

    await act(async () => {
      capturedStatusHandler!({
        origin: serverUrl,
        userId: 1,
        generation: 1,
        status: 'connected',
      });
    });

    // Send mute changed event
    act(() => {
      capturedEventHandler!({
        origin: serverUrl,
        userId: 1,
        generation: 1,
        event: {
          type: 'notification-mute.changed',
          issueId: 88,
          muted: true,
        },
      });
    });

    const updatedData = queryClient.getQueryData<DesktopOverviewData>([
      'desktop-overview',
      serverUrl,
      userId,
    ]);
    expect(updatedData?.sections.assignedOpen[0]?.muted).toBe(true);
  });

  it('drops buffered events when switching server source or user partition', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { rerender } = renderHook(
      ({ server, uid, fetching }) => useRealtimeSync(server, uid, fetching),
      {
        wrapper,
        initialProps: { server: 'https://serverA.example.com', uid: 1, fetching: true },
      },
    );

    await act(async () => {
      capturedStatusHandler!({
        origin: 'https://serverA.example.com',
        userId: 1,
        generation: 1,
        status: 'connected',
      });
    });

    // Event arrives on Server A while fetching -> buffered in Server A
    capturedEventHandler!({
      origin: 'https://serverA.example.com',
      userId: 1,
      generation: 1,
      event: {
        type: 'issue.changed',
        issueId: 99,
        updatedAt: new Date().toISOString(),
        actorId: 1,
      },
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Switch partition to Server B
    act(() => {
      rerender({ server: 'https://serverB.example.com', uid: 2, fetching: false });
    });

    // Server A's buffered event must NOT be flushed into Server B
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['desktop-overview', 'https://serverB.example.com', 2],
    });
  });

  it('discards events with mismatched origin or userId or stale generation', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { rerender } = renderHook(
      ({ server, uid }) => useRealtimeSync(server, uid, false),
      {
        wrapper,
        initialProps: { server: 'https://serverA.example.com', uid: 1 },
      },
    );

    // Connect Server A with generation 1
    await act(async () => {
      capturedStatusHandler!({
        origin: 'https://serverA.example.com',
        userId: 1,
        generation: 1,
        status: 'connected',
      });
    });

    // 1. Event from Server B arrives while React is on Server A -> DISCARDED
    capturedEventHandler!({
      origin: 'https://serverB.example.com',
      userId: 1,
      generation: 1,
      event: {
        type: 'issue.changed',
        issueId: 101,
        updatedAt: new Date().toISOString(),
        actorId: 1,
      },
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // 2. Event for User 2 arrives while React is User 1 -> DISCARDED
    capturedEventHandler!({
      origin: 'https://serverA.example.com',
      userId: 2,
      generation: 1,
      event: {
        type: 'issue.changed',
        issueId: 102,
        updatedAt: new Date().toISOString(),
        actorId: 2,
      },
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // 3. Switch React to Server B, User 2
    act(() => {
      rerender({ server: 'https://serverB.example.com', uid: 2 });
    });

    // Connect Server B with generation 2
    await act(async () => {
      capturedStatusHandler!({
        origin: 'https://serverB.example.com',
        userId: 2,
        generation: 2,
        status: 'connected',
      });
    });

    // Event on Server B for User 2 with generation 2 -> ACCEPTED
    capturedEventHandler!({
      origin: 'https://serverB.example.com',
      userId: 2,
      generation: 2,
      event: {
        type: 'issue.changed',
        issueId: 202,
        updatedAt: new Date().toISOString(),
        actorId: 2,
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['desktop-overview', 'https://serverb.example.com', 2],
    });
  });

  it('gates events on connected status until snapshot refetch completes, then flushes matching events', async () => {
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });

    const queryClient = new QueryClient();
    let resolveRefetch!: () => void;
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries').mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveRefetch = resolve;
      }) as any;
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useRealtimeSync('http://localhost:3101', 1, false), { wrapper });

    // Status connects -> gate opens, triggers refetch
    await act(async () => {
      capturedStatusHandler!({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        status: 'connected',
      });
    });

    expect(refetchSpy).toHaveBeenCalledTimes(1);

    // Event arrives while snapshot refetch is in-flight -> buffered
    capturedEventHandler!({
      origin: 'http://localhost:3101',
      userId: 1,
      generation: 1,
      event: {
        type: 'issue.changed',
        issueId: 50,
        updatedAt: new Date().toISOString(),
        actorId: 1,
      },
    });

    expect(invalidateSpy).not.toHaveBeenCalled();

    // Snapshot refetch finishes
    await act(async () => {
      resolveRefetch();
    });

    // Buffered event is flushed
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['desktop-overview', 'http://localhost:3101', 1],
    });
  });

  it('sets disconnected and does not register listeners when userId is null or <= 0', async () => {
    const listenEventSpy = vi.spyOn(tauriBridge, 'listenRealtimeEvent');
    const listenStatusSpy = vi.spyOn(tauriBridge, 'listenRealtimeStatus');

    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useRealtimeSync('http://localhost:3101', null, false), {
      wrapper,
    });

    expect(result.current.realtimeStatus).toBe('disconnected');
    expect(listenEventSpy).not.toHaveBeenCalled();
    expect(listenStatusSpy).not.toHaveBeenCalled();
  });

  it('recovers connected state from snapshot when connected was emitted before listeners were registered and processes subsequent events', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    // Connected was emitted before listener was registered -> saved in snapshot
    vi.spyOn(tauriBridge, 'getRealtimeStatus').mockResolvedValue({
      origin: 'http://localhost:3101',
      userId: 1,
      generation: 1,
      status: 'connected',
    });

    const queryClient = new QueryClient();
    vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue([] as any);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () => useRealtimeSync('http://localhost:3101', 1, false),
      { wrapper },
    );

    // Wait for listeners and snapshot promise resolution
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Status recovered to connected from snapshot!
    expect(result.current.realtimeStatus).toBe('connected');

    // Subsequent events with the same generation 1 are processed properly
    await act(async () => {
      capturedEventHandler!({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        event: {
          type: 'issue.changed',
          issueId: 77,
          updatedAt: new Date().toISOString(),
          actorId: 1,
        },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['desktop-overview', 'http://localhost:3101', 1],
    });
  });

  it('does not rollback when status snapshot is older than live event or status', async () => {
    let capturedEventHandler: ((ev: RealtimeEventEnvelope) => void) | null = null;
    let capturedStatusHandler: ((ev: RealtimeStatusEnvelope) => void) | null = null;

    vi.spyOn(tauriBridge, 'listenRealtimeEvent').mockImplementation(async (cb) => {
      capturedEventHandler = cb;
      return () => {};
    });
    vi.spyOn(tauriBridge, 'listenRealtimeStatus').mockImplementation(async (cb) => {
      capturedStatusHandler = cb;
      return () => {};
    });

    let resolveSnapshot!: (val: RealtimeStatusEnvelope) => void;
    vi.spyOn(tauriBridge, 'getRealtimeStatus').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        }),
    );

    const queryClient = new QueryClient();
    vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue([] as any);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () => useRealtimeSync('http://localhost:3101', 1, false),
      { wrapper },
    );

    // Live status receives generation 2
    await act(async () => {
      capturedStatusHandler!({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 2,
        status: 'connected',
      });
    });

    expect(result.current.realtimeStatus).toBe('connected');

    // Snapshot with older generation 1 now resolves
    await act(async () => {
      resolveSnapshot({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        status: 'disconnected',
      });
      await Promise.resolve();
    });

    // Must NOT roll back to disconnected!
    expect(result.current.realtimeStatus).toBe('connected');

    // Events for generation 2 must still be processed
    await act(async () => {
      capturedEventHandler!({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 2,
        event: {
          type: 'issue.changed',
          issueId: 99,
          updatedAt: new Date().toISOString(),
          actorId: 1,
        },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['desktop-overview', 'http://localhost:3101', 1],
    });

    // Stale generation 1 event is rejected
    invalidateSpy.mockClear();
    await act(async () => {
      capturedEventHandler!({
        origin: 'http://localhost:3101',
        userId: 1,
        generation: 1,
        event: {
          type: 'issue.changed',
          issueId: 100,
          updatedAt: new Date().toISOString(),
          actorId: 1,
        },
      });
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

