import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';

const mocks = vi.hoisted(() => ({ logout: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 7, username: 'alice', displayName: 'Alice', role: 'USER', active: true }, logout: mocks.logout }),
}));

describe('ProfilePage', () => {
  afterEach(() => { vi.unstubAllGlobals(); mocks.logout.mockClear(); });

  it('submits the display name and password through independent forms', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Response(JSON.stringify({ user: { id: 7, username: 'alice', displayName: 'Alice Chen', role: 'USER', active: true } }), { headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><ProfilePage /></QueryClientProvider>);

    const displayName = screen.getByLabelText(/显示名称/);
    await user.clear(displayName);
    await user.type(displayName, 'Alice Chen');
    await user.click(screen.getByRole('button', { name: '保存显示名称' }));
    expect(await screen.findByRole('status')).toHaveTextContent('显示名称已更新');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/profile'), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Alice Chen' }) }));

    await user.type(screen.getByLabelText(/^当前密码/, { selector: 'input' }), 'old-password');
    await user.type(screen.getByLabelText(/^新密码/, { selector: 'input' }), 'new-password');
    await user.type(screen.getByLabelText(/^确认新密码/, { selector: 'input' }), 'different');
    expect(screen.getByRole('alert')).toHaveTextContent('两次输入的新密码不一致');
    await user.clear(screen.getByLabelText(/^确认新密码/, { selector: 'input' }));
    await user.type(screen.getByLabelText(/^确认新密码/, { selector: 'input' }), 'new-password');
    await user.click(screen.getByRole('button', { name: '修改密码并重新登录' }));

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/change-password'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password' }) }));
  });

  it('allows password visibility to be toggled', async () => {
    const client = new QueryClient();
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><ProfilePage /></QueryClientProvider>);
    const input = screen.getByLabelText(/^当前密码/, { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: '显示当前密码' }));
    expect(input).toHaveAttribute('type', 'text');
  });
});
