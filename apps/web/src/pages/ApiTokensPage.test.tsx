import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiTokensPage } from './ApiTokensPage';

describe('ApiTokensPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a token and only reveals its plaintext in the result panel', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          token: 'ift_created-secret',
          apiToken: { id: 1, name: 'CI 发布', prefix: 'ift_crea', expiresAt: null, lastUsedAt: null, createdAt: '2026-08-29T10:00:00.000Z' },
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ tokens: [] }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = userEvent.setup();

    render(<QueryClientProvider client={client}><ApiTokensPage /></QueryClientProvider>);
    await screen.findByText('暂无 API Token');
    await user.type(screen.getByLabelText(/名称/), 'CI 发布');
    await user.selectOptions(screen.getByLabelText('有效期'), 'never');
    await user.click(screen.getByRole('button', { name: '创建 Token' }));

    expect(await screen.findByText('ift_created-secret')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/api-tokens'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'CI 发布', expiresInDays: null }),
    })));
  });
});
