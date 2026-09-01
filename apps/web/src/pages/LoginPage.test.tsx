import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage, resolveSafeRedirectTarget } from './LoginPage';

const mockUseAuth = vi.fn();
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('LoginPage and resolveSafeRedirectTarget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('resolveSafeRedirectTarget', () => {
    it('preserves pathname, search query, and hash', () => {
      expect(
        resolveSafeRedirectTarget({
          pathname: '/desktop/authorize',
          search: '?code=ABCD-EF23',
          hash: '#verify',
        }),
      ).toBe('/desktop/authorize?code=ABCD-EF23#verify');

      expect(
        resolveSafeRedirectTarget({
          pathname: '/desktop/authorize',
          search: '?code=ABCD-EF23',
        }),
      ).toBe('/desktop/authorize?code=ABCD-EF23');
    });

    it('handles string target correctly', () => {
      expect(resolveSafeRedirectTarget('/desktop/authorize?code=TEST-1234')).toBe(
        '/desktop/authorize?code=TEST-1234',
      );
    });

    it('falls back to /issues for missing, empty, or malicious targets', () => {
      expect(resolveSafeRedirectTarget(null)).toBe('/issues');
      expect(resolveSafeRedirectTarget(undefined)).toBe('/issues');
      expect(resolveSafeRedirectTarget('')).toBe('/issues');
      expect(resolveSafeRedirectTarget('   ')).toBe('/issues');
      expect(resolveSafeRedirectTarget('https://evil.com')).toBe('/issues');
      expect(resolveSafeRedirectTarget('//evil.com/desktop/authorize')).toBe('/issues');
      expect(resolveSafeRedirectTarget('/\\evil.com')).toBe('/issues');
      expect(resolveSafeRedirectTarget('\\\\evil.com')).toBe('/issues');
    });
  });

  describe('LoginPage Component', () => {
    it('redirects already logged-in user to destination with query and hash', () => {
      mockUseAuth.mockReturnValue({
        user: { id: 1, username: 'testuser', displayName: 'Test User' },
        settings: { platformName: 'IssueFlow', description: 'desc' },
      });

      const client = new QueryClient();

      render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/login',
              state: {
                from: {
                  pathname: '/desktop/authorize',
                  search: '?code=DESK-9988',
                  hash: '#target',
                },
              },
            },
          ]}
        >
          <QueryClientProvider client={client}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/desktop/authorize"
                element={<div>Desktop Authorize Destination</div>}
              />
              <Route path="/issues" element={<div>Issues List Destination</div>} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );

      expect(screen.getByText('Desktop Authorize Destination')).toBeInTheDocument();
    });

    it('redirects already logged-in user to /issues when no target specified', () => {
      mockUseAuth.mockReturnValue({
        user: { id: 1, username: 'testuser', displayName: 'Test User' },
        settings: { platformName: 'IssueFlow', description: 'desc' },
      });

      const client = new QueryClient();

      render(
        <MemoryRouter initialEntries={['/login']}>
          <QueryClientProvider client={client}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/issues" element={<div>Issues List Destination</div>} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );

      expect(screen.getByText('Issues List Destination')).toBeInTheDocument();
    });

    it('submits login and navigates to target preserving query code', async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        settings: { platformName: 'IssueFlow', description: 'desc' },
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/auth/login')) {
          return new Response(
            JSON.stringify({
              user: { id: 1, username: 'testuser', displayName: 'Test User', role: 'USER' },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({}), { status: 404 });
      });

      vi.stubGlobal('fetch', fetchMock);
      const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      const user = userEvent.setup();

      render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/login',
              state: {
                from: {
                  pathname: '/desktop/authorize',
                  search: '?code=FLOW-4455',
                },
              },
            },
          ]}
        >
          <QueryClientProvider client={client}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/desktop/authorize"
                element={<div>Desktop Authorize Page Reached</div>}
              />
              <Route path="/issues" element={<div>Issues List</div>} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );

      expect(screen.getByRole('heading', { name: '欢迎回来' })).toBeInTheDocument();

      await user.type(screen.getByLabelText('用户名'), 'testuser');
      await user.type(screen.getByLabelText('密码'), 'password123');
      await user.click(screen.getByRole('button', { name: '登录' }));

      await waitFor(() => {
        expect(screen.getByText('Desktop Authorize Page Reached')).toBeInTheDocument();
      });
    });
  });
});
