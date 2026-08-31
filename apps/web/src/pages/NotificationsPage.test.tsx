import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage';

describe('NotificationsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('groups notifications from the same issue and marks the whole issue as read', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Response(JSON.stringify({ ok: true, count: 2 }), { headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({
        items: [
          { id: 3, type: 'COMMENT_CREATED', message: '新增了一条评论', readAt: null, createdAt: '2026-08-31T10:00:00.000Z', issue: { id: 42, title: '登录失败' } },
          { id: 2, type: 'ISSUE_EDITED', message: '更新了 Issue 描述', readAt: '2026-08-31T09:30:00.000Z', createdAt: '2026-08-31T09:00:00.000Z', issue: { id: 42, title: '登录失败' } },
          { id: 1, type: 'SYSTEM', title: '系统维护', message: '今晚进行例行维护', readAt: null, createdAt: '2026-08-30T10:00:00.000Z' },
        ],
        unread: 2,
        pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/notifications']}><NotificationsPage /></MemoryRouter></QueryClientProvider>);

    expect(await screen.findByRole('link', { name: '#42 登录失败' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: '#42 登录失败' })).toHaveLength(1);
    expect(screen.getByText('2 条动态')).toBeVisible();
    expect(screen.getByText('新增了一条评论')).toBeVisible();
    expect(screen.getByText('更新了 Issue 描述')).toBeVisible();
    expect(screen.getByText('系统维护')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '将 Issue #42 的通知全部标为已读' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/notifications/issues/42/read', expect.objectContaining({ method: 'PATCH' })));
  });
});
