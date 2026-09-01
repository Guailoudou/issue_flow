import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeOriginKey } from '../../lib/overviewCache';
import { tauriBridge } from '../../lib/tauri/bridge';
import type {
  DesktopOverviewData,
  RealtimeEvent,
  RealtimeEventEnvelope,
  RealtimeStatus,
  RealtimeStatusEnvelope,
} from '../../lib/types';

interface BufferedEventItem {
  event: RealtimeEvent;
  partition: string;
  listenerGen: number;
  connectionGen: number;
}

export function useRealtimeSync(
  serverUrl: string,
  userIdOrFetching?: number | boolean | null,
  isFetchingOrNavigate?: boolean | ((page: string) => void),
  maybeNavigate?: (page: string) => void,
) {
  let effectiveUserId = 0;
  let isSnapshotFetching = false;
  let onNavigate: ((page: string) => void) | undefined = undefined;

  if (typeof userIdOrFetching === 'number') {
    effectiveUserId = userIdOrFetching;
    isSnapshotFetching = Boolean(isFetchingOrNavigate);
    onNavigate = maybeNavigate;
  } else if (typeof userIdOrFetching === 'boolean') {
    isSnapshotFetching = userIdOrFetching;
    onNavigate = typeof isFetchingOrNavigate === 'function' ? isFetchingOrNavigate : undefined;
  } else {
    if (typeof isFetchingOrNavigate === 'boolean') {
      isSnapshotFetching = isFetchingOrNavigate;
      onNavigate = maybeNavigate;
    } else if (typeof isFetchingOrNavigate === 'function') {
      onNavigate = isFetchingOrNavigate;
    }
  }

  const queryClient = useQueryClient();
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');

  const canonicalOrigin = normalizeOriginKey(serverUrl);
  const partitionKey = `${canonicalOrigin}:${effectiveUserId}`;

  const currentPartitionRef = useRef(partitionKey);
  const listenerGenRef = useRef(0);
  const connectionGenRef = useRef(0);
  const isSnapshotFetchingRef = useRef(isSnapshotFetching);
  isSnapshotFetchingRef.current = isSnapshotFetching;

  const snapshotGateRef = useRef(false);
  const eventBufferRef = useRef<BufferedEventItem[]>([]);
  const seenNotificationIdsRef = useRef<Set<number>>(new Set());
  const issueVersionsRef = useRef<Map<number, number>>(new Map());

  // Clear buffers and partitioned seen state when partition (source / user) changes
  if (currentPartitionRef.current !== partitionKey) {
    currentPartitionRef.current = partitionKey;
    listenerGenRef.current++;
    connectionGenRef.current = 0;
    snapshotGateRef.current = false;
    eventBufferRef.current = [];
    seenNotificationIdsRef.current.clear();
    issueVersionsRef.current.clear();
  }

  // Process a single event against the query cache
  const processEvent = useCallback(
    (event: RealtimeEvent, targetOrigin: string, targetUid: number) => {
      const overviewQueryKey = ['desktop-overview', targetOrigin, targetUid];

      switch (event.type) {
        case 'notification.created': {
          const notifId = Number(event.notification.id);
          if (seenNotificationIdsRef.current.has(notifId)) {
            return;
          }
          if (seenNotificationIdsRef.current.size >= 500) {
            const oldest = seenNotificationIdsRef.current.values().next().value;
            if (oldest !== undefined) seenNotificationIdsRef.current.delete(oldest);
          }
          seenNotificationIdsRef.current.add(notifId);
          queryClient.invalidateQueries({ queryKey: overviewQueryKey });
          break;
        }

        case 'issue.changed': {
          const eventTime = new Date(event.updatedAt).getTime();
          const lastUpdated = issueVersionsRef.current.get(event.issueId);
          if (lastUpdated && eventTime <= lastUpdated) {
            return;
          }
          if (issueVersionsRef.current.size >= 500) {
            const oldest = issueVersionsRef.current.keys().next().value;
            if (oldest !== undefined) issueVersionsRef.current.delete(oldest);
          }
          issueVersionsRef.current.set(event.issueId, eventTime);
          queryClient.invalidateQueries({ queryKey: overviewQueryKey });
          break;
        }

        case 'notification-mute.changed': {
          queryClient.setQueryData<DesktopOverviewData>(overviewQueryKey, (old) => {
            if (!old) return old;
            const updateItem = (item: (typeof old.sections.assignedOpen)[0]) =>
              item.id === event.issueId ? { ...item, muted: event.muted } : item;

            return {
              ...old,
              sections: {
                assignedOpen: old.sections.assignedOpen.map(updateItem),
                followedOpen: old.sections.followedOpen.map(updateItem),
                recentlyClosed: old.sections.recentlyClosed.map(updateItem),
              },
            };
          });
          queryClient.invalidateQueries({ queryKey: overviewQueryKey });
          break;
        }

        case 'subscription.changed':
        case 'notification.read': {
          queryClient.invalidateQueries({ queryKey: overviewQueryKey });
          break;
        }

        case 'preferences.changed': {
          queryClient.invalidateQueries({ queryKey: ['desktop-preferences'] });
          queryClient.invalidateQueries({ queryKey: overviewQueryKey });
          break;
        }

        default:
          break;
      }
    },
    [queryClient],
  );

  // Flush buffered events once manual snapshot fetch completes (if snapshot gate is also false)
  useEffect(() => {
    if (!isSnapshotFetching && !snapshotGateRef.current) {
      if (eventBufferRef.current.length > 0) {
        const curGen = connectionGenRef.current;
        const curPart = currentPartitionRef.current;
        const buffered = [...eventBufferRef.current];
        eventBufferRef.current = [];
        for (const item of buffered) {
          if (item.partition === curPart && item.connectionGen === curGen) {
            processEvent(item.event, canonicalOrigin, effectiveUserId);
          }
        }
      }
    }
  }, [isSnapshotFetching, canonicalOrigin, effectiveUserId, processEvent]);

  // Stable listeners registered per source partition
  useEffect(() => {
    // If userId is missing or invalid (e.g. <= 0 or null), directly set disconnected and do not register listeners
    if (effectiveUserId <= 0) {
      setRealtimeStatus('disconnected');
      return;
    }

    const currentListenerGen = ++listenerGenRef.current;
    let isCleanedUp = false;

    let unlistenEvent: (() => void) | null = null;
    let unlistenStatus: (() => void) | null = null;
    let unlistenNav: (() => void) | null = null;

    const currentOrigin = canonicalOrigin;
    const currentUid = effectiveUserId;
    const currentPart = `${currentOrigin}:${currentUid}`;

    const applyStatusEnvelope = (
      envelope: RealtimeStatusEnvelope,
      source: 'listener' | 'snapshot',
    ) => {
      if (isCleanedUp || listenerGenRef.current !== currentListenerGen) {
        return;
      }

      // Source Provenance verification: origin must match
      const envOrigin = envelope.origin ? normalizeOriginKey(envelope.origin) : '';
      if (envOrigin && envOrigin !== currentOrigin) {
        return;
      }

      // Generation check: drop stale generations
      if (envelope.generation < connectionGenRef.current) {
        return;
      }

      // If snapshot returns for the same generation, but live status was already established, do not re-trigger
      if (
        source === 'snapshot' &&
        envelope.generation === connectionGenRef.current &&
        connectionGenRef.current > 0
      ) {
        return;
      }

      if (envelope.status === 'connected') {
        // Connected status MUST have matching userId
        if (envelope.userId !== currentUid) {
          return;
        }

        connectionGenRef.current = envelope.generation;
        setRealtimeStatus('connected');
        snapshotGateRef.current = true;
        // Clear old generation buffer
        eventBufferRef.current = [];

        const newConnGen = envelope.generation;

        // Explicitly refetch overview snapshot for this partition and connection generation
        queryClient
          .refetchQueries({
            queryKey: ['desktop-overview', currentOrigin, currentUid],
          })
          .then(() => {
            if (
              isCleanedUp ||
              listenerGenRef.current !== currentListenerGen ||
              connectionGenRef.current !== newConnGen
            ) {
              return;
            }
            snapshotGateRef.current = false;
            // FIFO flush buffered events that match this connection generation
            const toFlush = [...eventBufferRef.current];
            eventBufferRef.current = [];
            for (const item of toFlush) {
              if (item.partition === currentPart && item.connectionGen === newConnGen) {
                processEvent(item.event, currentOrigin, currentUid);
              }
            }
          })
          .catch(() => {
            if (
              isCleanedUp ||
              listenerGenRef.current !== currentListenerGen ||
              connectionGenRef.current !== newConnGen
            ) {
              return;
            }
            snapshotGateRef.current = false;
            eventBufferRef.current = [];
          });
      } else {
        connectionGenRef.current = envelope.generation;
        setRealtimeStatus(envelope.status);
        snapshotGateRef.current = false;
      }
    };

    const statusPromise = tauriBridge.listenRealtimeStatus((envelope: RealtimeStatusEnvelope) => {
      applyStatusEnvelope(envelope, 'listener');
    });

    const eventPromise = tauriBridge.listenRealtimeEvent((envelope: RealtimeEventEnvelope) => {
      if (isCleanedUp || listenerGenRef.current !== currentListenerGen) {
        return;
      }

      // Source Provenance verification: origin + userId + generation must all match
      const envOrigin = envelope.origin ? normalizeOriginKey(envelope.origin) : '';
      if (
        envOrigin !== currentOrigin ||
        envelope.userId !== currentUid ||
        envelope.generation !== connectionGenRef.current
      ) {
        return;
      }

      const curConnGen = connectionGenRef.current;
      if (snapshotGateRef.current || isSnapshotFetchingRef.current) {
        if (eventBufferRef.current.length >= 500) {
          eventBufferRef.current.shift();
        }
        eventBufferRef.current.push({
          event: envelope.event,
          partition: currentPart,
          listenerGen: currentListenerGen,
          connectionGen: curConnGen,
        });
      } else {
        processEvent(envelope.event, currentOrigin, currentUid);
      }
    });

    const navPromise = onNavigate
      ? tauriBridge.listenNavigate((page) => {
          if (isCleanedUp || listenerGenRef.current !== currentListenerGen) {
            return;
          }
          onNavigate(page);
        })
      : Promise.resolve(null);

    Promise.all([statusPromise, eventPromise, navPromise]).then(
      ([unStatus, unEvent, unNav]) => {
        if (isCleanedUp || listenerGenRef.current !== currentListenerGen) {
          unStatus?.();
          unEvent?.();
          unNav?.();
          return;
        }
        unlistenStatus = unStatus;
        unlistenEvent = unEvent;
        unlistenNav = unNav;

        // Fetch latest status snapshot after listeners are attached
        tauriBridge
          .getRealtimeStatus()
          .then((snapshot) => {
            if (isCleanedUp || listenerGenRef.current !== currentListenerGen) {
              return;
            }
            applyStatusEnvelope(snapshot, 'snapshot');
          })
          .catch(() => {
            // Ignore snapshot fetch error
          });
      },
    );

    return () => {
      isCleanedUp = true;
      if (unlistenStatus) unlistenStatus();
      if (unlistenEvent) unlistenEvent();
      if (unlistenNav) unlistenNav();
    };
  }, [queryClient, canonicalOrigin, effectiveUserId, onNavigate, processEvent]);

  return {
    realtimeStatus,
    processEvent: (event: RealtimeEvent) =>
      processEvent(event, canonicalOrigin, effectiveUserId),
  };
}
