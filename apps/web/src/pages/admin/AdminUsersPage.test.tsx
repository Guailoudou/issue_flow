import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersPage } from './AdminUsersPage';

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'admin', displayName: 'Admin', role: 'ADMIN', active: true } }) }));

describe('AdminUsersPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lets an administrator edit another user username but not their own', async () => {
    const users = [
      { id: 1, username: 'admin', displayName: 'Admin', email: '', role: 'ADMIN', active: true },
      { id: 2, username: 'alice', displayName: 'Alice', email: '', role: 'USER', active: true },
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Response(JSON.stringify({ user: { ...users[1], username: 'alice-renamed' } }), { headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ items: users }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><AdminUsersPage /></QueryClientProvider>);

    const editButtons = await screen.findAllByRole('button', { name: '编辑用户名' });
    expect(editButtons[0]).toBeDisabled();
    await user.click(editButtons[1]);
    const username = screen.getByLabelText(/^用户名/, { selector: 'input' });
    await user.clear(username);
    await user.type(username, 'alice-renamed');
    await user.click(screen.getByRole('button', { name: '保存用户名' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/admin/users/2'), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ username: 'alice-renamed' }) })));
  });
});
