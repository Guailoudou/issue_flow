import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AdminYunxiaoPage } from './AdminYunxiaoPage';

const response = {
  integration: {
    enabled: true,
    edition: 'CENTRAL',
    baseUrl: 'https://openapi-rdc.aliyuncs.com',
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    repositoryName: 'issueflow',
    repositoryWebUrl: 'https://codeup.example.com/issueflow',
    hasToken: true,
    hasWebhookSecret: true,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestMessage: null,
    updatedAt: null,
  },
  webhook: { url: 'http://localhost:3101/api/integrations/yunxiao/webhook', events: ['Push Hook', 'Merge Request Hook'] },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AdminYunxiaoPage /></QueryClientProvider>);
}

describe('AdminYunxiaoPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Region 版隐藏组织 ID，敏感字段留空时不随保存请求发送', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();
    const edition = await screen.findByRole('combobox', { name: /云效版本/ });
    expect(screen.getByRole('textbox', { name: /组织 ID/ })).toBeInTheDocument();
    await user.selectOptions(edition, 'REGION');
    expect(screen.queryByRole('textbox', { name: /组织 ID/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload).not.toHaveProperty('token');
    expect(payload).not.toHaveProperty('webhookSecret');
    expect(payload.organizationId).toBe('');
  });
});
