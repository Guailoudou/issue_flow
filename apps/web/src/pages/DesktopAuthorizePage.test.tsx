import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopAuthorizePage } from './DesktopAuthorizePage';

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'testuser', displayName: 'Test User', role: 'USER' },
    settings: { platformName: 'IssueFlow' },
    loading: false,
  }),
}));

describe('DesktopAuthorizePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders device details and handles successful approval', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/desktop/pairings/verify')) {
        return new Response(
          JSON.stringify({
            pairingId: '11111111-2222-3333-4444-555555555555',
            deviceName: 'MacBook Pro 16',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            approvedAt: null,
            consumedAt: null,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/desktop/pairings/approve') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            pairingId: '11111111-2222-3333-4444-555555555555',
            status: 'APPROVED',
            approvedAt: new Date().toISOString(),
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/desktop/authorize?code=ABCD-EF23']}>
        <QueryClientProvider client={client}>
          <DesktopAuthorizePage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('MacBook Pro 16')).toBeInTheDocument();
    expect(screen.getByText('ABCD-EF23')).toBeInTheDocument();
    expect(
      screen.getByText(/批准后，该桌面设备将以您的当前账号身份访问 IssueFlow，您可随时在“设置 → API Token”中撤销该设备的授权。/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认批准授权' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认批准授权' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/desktop/pairings/approve'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ code: 'ABCD-EF23' }),
        }),
      );
    });

    expect(await screen.findByText('授权成功！')).toBeInTheDocument();
  });

  it('shows error state when pairing request is expired or invalid', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: { code: 'PAIRING_NOT_FOUND', message: 'Desktop authorization request was not found or has expired' },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    });

    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <MemoryRouter initialEntries={['/desktop/authorize?code=EXPIRED1']}>
        <QueryClientProvider client={client}>
          <DesktopAuthorizePage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Desktop authorization request was not found or has expired/)).toBeInTheDocument();
  });
});
