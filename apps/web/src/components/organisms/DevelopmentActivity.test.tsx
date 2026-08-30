import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { DevelopmentActivity } from './DevelopmentActivity';

function renderActivity() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DevelopmentActivity issueId={42} /></QueryClientProvider>);
}

describe('DevelopmentActivity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('展示云效提交和合并请求信息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ references: [{
      id: 1,
      type: 'MERGE_REQUEST',
      externalId: 'mr-8',
      title: 'fixes #42 修复登录',
      url: 'https://codeup.example.com/repo/merge_requests/8',
      status: 'MERGED',
      sourceBranch: 'fix/login',
      targetBranch: 'main',
      authorName: '开发者',
      commitSha: '1234567890abcdef',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T01:00:00.000Z',
    }] }), { headers: { 'Content-Type': 'application/json' } })));
    renderActivity();
    expect(await screen.findByRole('link', { name: /fixes #42 修复登录/ })).toHaveAttribute('href', 'https://codeup.example.com/repo/merge_requests/8');
    expect(screen.getByText('fix/login → main')).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();
  });

  it('没有关联时展示空态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ references: [] }), { headers: { 'Content-Type': 'application/json' } })));
    renderActivity();
    expect(await screen.findByText('暂无关联提交或合并请求')).toBeInTheDocument();
  });
});
