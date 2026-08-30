import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('../../features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', displayName: 'Alice', role: 'USER', roles: ['DEVELOPMENT'] }, settings: { platformName: 'IssueFlow' }, logout: vi.fn() }),
}));

describe('AppShell', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('在移动端顶部显示未读通知数量', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ unread: 7 }), { headers: { 'Content-Type': 'application/json' } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/issues']}><Routes><Route element={<AppShell />}><Route path="/issues" element={<p>Issues</p>} /></Route></Routes></MemoryRouter></QueryClientProvider>);
    const mobileNotifications = await screen.findByRole('link', { name: '通知，7 条未读' });
    expect(within(mobileNotifications).getByText('7')).toBeVisible();
  });
});
