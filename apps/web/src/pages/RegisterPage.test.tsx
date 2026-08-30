import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './RegisterPage';

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: null, settings: { platformName: 'IssueFlow', description: '协作平台', defaultPageSize: 20, allowUserCreateIssue: true } }),
}));

afterEach(() => vi.unstubAllGlobals());

describe('RegisterPage', () => {
  it('提交与管理员创建用户一致的资料和邀请码，成功后进入 Issue 列表', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({ user: { id: 7, username: 'new_user', displayName: '新用户', email: 'new@example.com', role: 'USER', active: true } }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/register']}><Routes><Route path="/register" element={<RegisterPage />} /><Route path="/issues" element={<h1>Issue 列表</h1>} /></Routes></MemoryRouter></QueryClientProvider>);

    await user.type(screen.getByLabelText(/用户名/), 'new_user');
    await user.type(screen.getByLabelText(/显示名称/), '新用户');
    await user.type(screen.getByLabelText('邮箱'), 'new@example.com');
    await user.type(screen.getByLabelText(/密码/), 'password-123');
    await user.type(screen.getByLabelText(/邀请码/), 'invite-123');
    await user.click(screen.getByRole('button', { name: '注册并登录' }));

    expect(await screen.findByRole('heading', { name: 'Issue 列表' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ username: 'new_user', displayName: '新用户', email: 'new@example.com', password: 'password-123', inviteCode: 'invite-123' });
  });
});
