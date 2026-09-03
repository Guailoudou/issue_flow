import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from './components/Spinner';
import { AuthFlow } from './features/auth/AuthFlow';
import { IssueDetailPage } from './features/issue-detail/IssueDetailPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { useRealtimeSync } from './features/realtime/useRealtimeSync';
import { SettingsPage } from './features/settings/SettingsPage';
import {
  clearOverviewCache,
  getActiveUserPointer,
  getOverviewCache,
  normalizeOriginKey,
  setActiveUserPointer,
  setOverviewCache,
} from './lib/overviewCache';
import {
  onUnauthenticated,
  parseUnauthenticatedError,
  tauriBridge,
} from './lib/tauri/bridge';
import type {
  AppConfig,
  DesktopIssueItem,
  DesktopOverviewData,
  PublicUserInfo,
} from './lib/types';

type ViewMode = 'auth' | 'overview' | 'detail' | 'settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
});

function DesktopApp() {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('overview');
  const [selectedIssue, setSelectedIssue] = useState<DesktopIssueItem | null>(null);
  const [currentUser, setCurrentUser] = useState<PublicUserInfo | null>(null);
  const [serverUrl, setServerUrl] = useState('http://localhost:3101');
  const [pinned, setPinned] = useState(false);
  const [authPhase, setAuthPhase] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');

  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const authPhaseRef = useRef(authPhase);
  authPhaseRef.current = authPhase;

  const viewRef = useRef(view);
  viewRef.current = view;

  const canonicalOrigin = normalizeOriginKey(serverUrl);
  // Auth Phase Rule: Only when authenticated=true is verified, current user ID or origin active pointer is used
  const effectiveUserId =
    authPhase === 'authenticated'
      ? (currentUser?.id ?? getActiveUserPointer(serverUrl) ?? 0)
      : 0;

  // Single-owner idempotent transition to unauthenticated state with explicit target source
  const transitionToUnauthenticated = useCallback(
    (targetServerUrl?: string, targetUserId?: number | null) => {
      const currentActiveOrigin = normalizeOriginKey(serverUrlRef.current);
      const urlToClean = targetServerUrl ?? serverUrlRef.current;
      const originToClean = normalizeOriginKey(urlToClean);
      const isTargetActive = !originToClean || originToClean === currentActiveOrigin;

      // 1. Clear persistent overview cache and pointer for the target origin ONLY
      if (originToClean) {
        const uidToClean =
          targetUserId !== undefined
            ? targetUserId
            : (isTargetActive ? currentUserRef.current?.id : null) ??
              getActiveUserPointer(urlToClean);
        clearOverviewCache(urlToClean, uidToClean);
      }

      // 2. ONLY if the error belongs to the currently active source/user, reset state & switch to auth!
      if (isTargetActive) {
        setAuthPhase('unauthenticated');
        setCurrentUser(null);
        setSelectedIssue(null);
        setView('auth');

        // Remove active query caches & clear
        qc.removeQueries({ queryKey: ['desktop-overview'] });
        qc.removeQueries({ queryKey: ['desktop-preferences'] });
        qc.clear();
      }
    },
    [qc],
  );

  // Overview Query partitioned strictly by canonicalOrigin + effectiveUserId
  const overviewQuery = useQuery<DesktopOverviewData>({
    queryKey: ['desktop-overview', canonicalOrigin, effectiveUserId],
    queryFn: async () => {
      const data = await tauriBridge.getOverview();
      if (currentUser?.id) {
        setOverviewCache(serverUrl, currentUser.id, data);
      }
      return data;
    },
    initialData: () => {
      // In auth checking or unauthenticated phase, forbid hydrating cache
      if (authPhase !== 'authenticated' || view === 'auth') return undefined;
      return getOverviewCache(serverUrl, currentUser?.id) || undefined;
    },
    enabled: authPhase === 'authenticated' && view !== 'auth',
    refetchInterval: false,
  });

  // Hook for realtime events with event buffering during snapshot fetch
  const { realtimeStatus } = useRealtimeSync(
    serverUrl,
    authPhase === 'authenticated' ? effectiveUserId : null,
    overviewQuery.isFetching,
    useCallback((navPage: string) => {
      if (navPage === 'settings') {
        setView('settings');
      }
    }, []),
  );

  // Detail page absorbs newer issue versions or merges independent realtime fields on same version
  useEffect(() => {
    if (selectedIssue && overviewQuery.data) {
      const allIssues = [
        ...overviewQuery.data.sections.assignedOpen,
        ...overviewQuery.data.sections.followedOpen,
        ...overviewQuery.data.sections.recentlyClosed,
      ];
      const match = allIssues.find((i) => i.id === selectedIssue.id);
      if (match) {
        setSelectedIssue((prev) => {
          if (!prev || prev.id !== match.id) return prev;
          const matchTime = new Date(match.updatedAt).getTime();
          const curTime = new Date(prev.updatedAt).getTime();

          if (matchTime > curTime) {
            return match;
          } else if (matchTime === curTime) {
            return match;
          } else {
            // Older updatedAt: NEVER overwrite state, closedAt, title, etc.
            // ONLY merge independent realtime fields (subscribed, muted, unreadCount, latestNotification)
            return {
              ...prev,
              subscribed: match.subscribed,
              muted: match.muted,
              unreadCount: match.unreadCount,
              latestNotification: match.latestNotification,
            };
          }
        });
      }
    }
  }, [overviewQuery.data, selectedIssue?.id]);

  // Global UNAUTHENTICATED error listener from any Tauri command
  useEffect(() => {
    return onUnauthenticated((detail) => {
      if (viewRef.current !== 'auth' || authPhaseRef.current !== 'unauthenticated') {
        transitionToUnauthenticated(detail?.origin);
      }
    });
  }, [transitionToUnauthenticated]);

  // Handle unauthenticated status from WebSocket/Keychain
  useEffect(() => {
    if (
      realtimeStatus === 'unauthenticated' &&
      authPhaseRef.current !== 'checking' &&
      viewRef.current !== 'auth'
    ) {
      transitionToUnauthenticated(serverUrlRef.current, currentUserRef.current?.id ?? null);
    }
  }, [realtimeStatus, transitionToUnauthenticated]);

  // Initial auth check and config load
  useEffect(() => {
    let resolvedUrl = serverUrlRef.current;
    Promise.all([tauriBridge.checkAuthStatus(), tauriBridge.getAppConfig()])
      .then(([auth, cfg]) => {
        const loadedUrl = cfg?.serverUrl || 'http://localhost:3101';
        resolvedUrl = loadedUrl;
        serverUrlRef.current = loadedUrl;
        if (cfg) {
          setServerUrl(cfg.serverUrl);
          setPinned(cfg.pinned);
        }
        if (auth.authenticated) {
          setCurrentUser(auth.user);
          if (auth.user?.id && cfg?.serverUrl) {
            setActiveUserPointer(cfg.serverUrl, auth.user.id);
          }
          setAuthPhase('authenticated');
          setView('overview');
        } else {
          transitionToUnauthenticated(loadedUrl, auth.user?.id ?? null);
        }
      })
      .catch((err) => {
        const parsed = parseUnauthenticatedError(err);
        const urlToUse = parsed.origin || resolvedUrl;
        serverUrlRef.current = urlToUse;
        transitionToUnauthenticated(urlToUse);
      });
  }, [transitionToUnauthenticated]);

  const handleTogglePin = async () => {
    const prev = pinned;
    const next = !prev;
    setPinned(next); // Optimistic update
    try {
      await tauriBridge.setWindowPinned(next);
    } catch (err) {
      // Rollback on failure
      setPinned(prev);
      throw err;
    }
  };

  const handleRefresh = async () => {
    if (realtimeStatus !== 'connected' && realtimeStatus !== 'connecting') {
      await tauriBridge.reconnectRealtime().catch(() => undefined);
    }
    await overviewQuery.refetch();
  };

  const handleAuthenticated = async () => {
    let targetUrl = serverUrlRef.current;
    try {
      const [cfg, auth] = await Promise.all([
        tauriBridge.getAppConfig(),
        tauriBridge.checkAuthStatus(),
      ]);
      targetUrl = cfg?.serverUrl || serverUrlRef.current;
      serverUrlRef.current = targetUrl;
      setSelectedIssue(null);
      qc.clear();
      if (cfg) {
        setServerUrl(cfg.serverUrl);
        setPinned(cfg.pinned);
      }
      if (auth.authenticated) {
        setCurrentUser(auth.user);
        if (auth.user?.id && cfg?.serverUrl) {
          setActiveUserPointer(cfg.serverUrl, auth.user.id);
        }
        setAuthPhase('authenticated');
        setView('overview');
      } else {
        transitionToUnauthenticated(targetUrl, auth.user?.id ?? null);
      }
    } catch (err) {
      const parsed = parseUnauthenticatedError(err);
      const urlToUse = parsed.origin || targetUrl;
      serverUrlRef.current = urlToUse;
      transitionToUnauthenticated(urlToUse);
    }
  };

  const handleConfigSaved = async (newConfig: AppConfig) => {
    setPinned(newConfig.pinned);

    if (newConfig.serverUrl !== serverUrl) {
      serverUrlRef.current = newConfig.serverUrl;
      setServerUrl(newConfig.serverUrl);
      setSelectedIssue(null);
      qc.clear();

      try {
        const auth = await tauriBridge.checkAuthStatus();
        if (auth.authenticated) {
          setCurrentUser(auth.user);
          if (auth.user?.id) {
            setActiveUserPointer(newConfig.serverUrl, auth.user.id);
          }
          setAuthPhase('authenticated');
          setView('overview');
        } else {
          transitionToUnauthenticated(newConfig.serverUrl, auth.user?.id ?? null);
        }
      } catch (err) {
        const parsed = parseUnauthenticatedError(err);
        transitionToUnauthenticated(parsed.origin || newConfig.serverUrl, null);
      }
    }
  };

  const handleLogout = () => {
    transitionToUnauthenticated(serverUrlRef.current, currentUserRef.current?.id ?? null);
  };

  if (authPhase === 'checking') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50">
        <Spinner label="正在启动 IssueFlow 浮窗…" />
      </div>
    );
  }

  if (view === 'auth') {
    return <AuthFlow onAuthenticated={handleAuthenticated} />;
  }

  if (view === 'settings') {
    return (
      <SettingsPage
        onBack={() => setView('overview')}
        onLogout={handleLogout}
        onSaved={handleConfigSaved}
        currentUser={currentUser}
        realtimeStatus={realtimeStatus}
      />
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* Overview page kept mounted to preserve scroll, search, and collapse state */}
      <div
        hidden={view !== 'overview'}
        aria-hidden={view !== 'overview'}
        className={view === 'overview' ? 'h-full w-full' : 'hidden'}
      >
        <OverviewPage
          overviewData={overviewQuery.data ?? null}
          isLoading={overviewQuery.isLoading || overviewQuery.isFetching}
          isError={overviewQuery.isError}
          errorMessage={
            overviewQuery.error instanceof Error
              ? overviewQuery.error.message
              : '未能成功拉取数据，请检查网络或服务连接'
          }
          realtimeStatus={realtimeStatus}
          pinned={pinned}
          onTogglePin={handleTogglePin}
          onRefresh={handleRefresh}
          onOpenSettings={() => setView('settings')}
          onSelectIssue={(issue) => {
            setSelectedIssue(issue);
            setView('detail');
          }}
          serverUrl={serverUrl}
        />
      </div>

      {/* Detail page rendered when viewing detail */}
      {view === 'detail' && selectedIssue && (
        <div className="absolute inset-0 z-20 h-full w-full">
          <IssueDetailPage
            issue={selectedIssue}
            onBack={() => {
              setSelectedIssue(null);
              setView('overview');
            }}
            onRefresh={handleRefresh}
            serverUrl={serverUrl}
            realtimeStatus={realtimeStatus}
          />
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DesktopApp />
    </QueryClientProvider>
  );
}
