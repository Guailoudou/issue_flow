import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api } from '../../lib/api';
import type { PlatformSettings, User } from '../../lib/types';
import { clearCachedUser, clearSessionUser, readCachedUser, SESSION_QUERY_KEY, writeCachedUser } from './sessionStorage';

type AuthContextValue = { user: User | null; settings: PlatformSettings; loading: boolean; logout: () => Promise<void> };
const defaults: PlatformSettings = { platformName: 'IssueFlow', description: '让协作事项清晰流动', defaultPageSize: 20, allowUserCreateIssue: true };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        const response = await api<{ user: User }>('/auth/me');
        const user = writeCachedUser(response.user);
        if (!user) throw new Error('服务端返回的用户信息无效');
        return user;
      } catch (error) {
        clearCachedUser();
        throw error;
      }
    },
    initialData: readCachedUser,
    initialDataUpdatedAt: 0,
    refetchOnMount: 'always',
    retry: false,
    staleTime: 60_000,
  });
  const settingQuery = useQuery({ queryKey: ['platform-settings-public'], queryFn: async () => { const raw = await api<Omit<PlatformSettings, 'platformName'> & { name: string }>('/settings'); return { ...raw, platformName: raw.name }; }, retry: false, staleTime: 300_000 });
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Local sign-out must succeed even if the server is temporarily unavailable.
    } finally {
      clearSessionUser(queryClient);
      window.location.assign('/login');
    }
  };
  return <AuthContext.Provider value={{ user: session.isError ? null : session.data ?? null, settings: settingQuery.data ?? defaults, loading: session.isPending, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth 必须在 AuthProvider 中使用'); return value; }
