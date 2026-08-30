import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './AuthProvider';
import { AUTH_USER_STORAGE_KEY } from './sessionStorage';

const cachedUser = { id: 7, username: 'lin', displayName: '林工程师', email: 'lin@example.com', role: 'USER', active: true } as const;

function Harness() {
  const { user, loading } = useAuth();
  return <div>{loading ? '载入中' : user?.displayName ?? '未登录'}</div>;
}

function renderProvider(children: ReactNode = <Harness />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>) };
}

describe('AuthProvider 本地会话快照', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('刷新时先恢复合法缓存并立即向服务端校验', async () => {
    window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(cachedUser));
    let resolveMe!: (value: Response) => void;
    const me = new Promise<Response>((resolve) => { resolveMe = resolve; });
    const fetchMock = vi.fn((input: string | URL | Request) => String(input).endsWith('/auth/me')
      ? me
      : Promise.resolve(new Response(JSON.stringify({ name: 'IssueFlow', defaultPageSize: 20, allowUserCreateIssue: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    renderProvider();

    expect(screen.getByText('林工程师')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'include' }));

    resolveMe(new Response(JSON.stringify({ user: cachedUser }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('清除形状不合法的缓存', async () => {
    window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify({ ...cachedUser, password: '不应缓存' }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).endsWith('/auth/me')
      ? new Response(JSON.stringify({ error: { message: '未登录' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify({ name: 'IssueFlow', defaultPageSize: 20, allowUserCreateIssue: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    renderProvider();

    await screen.findByText('未登录');
    expect(window.localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
  });

  it('服务端会话失效后撤销缓存用户', async () => {
    window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(cachedUser));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).endsWith('/auth/me')
      ? new Response(JSON.stringify({ error: { message: '会话已失效' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify({ name: 'IssueFlow', defaultPageSize: 20, allowUserCreateIssue: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    renderProvider();

    expect(screen.getByText('林工程师')).toBeInTheDocument();
    await screen.findByText('未登录');
    expect(window.localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
  });
});
