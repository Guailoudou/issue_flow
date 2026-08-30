import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueAttachments } from './IssueAttachments';

function renderAttachments() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><IssueAttachments issueId={1} /></QueryClientProvider>); }

describe('IssueAttachments', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('只展示已有附件，不提供上传入口', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ attachments: [
      { id: 7, issueId: 1, fileName: '页面.png', mimeType: 'image/png', size: 2048, url: '/api/attachments/7/content', createdAt: '2026-08-29T00:00:00.000Z', uploader: { id: 1, username: 'admin', displayName: '管理员', role: 'ADMIN', active: true }, canDelete: true },
      { id: 8, issueId: 1, fileName: '需求.pdf', mimeType: 'application/pdf', size: 4096, url: '/api/attachments/8/content', createdAt: '2026-08-29T00:00:00.000Z', uploader: { id: 1, username: 'admin', displayName: '管理员', role: 'ADMIN', active: true }, canDelete: true },
    ] }), { headers: { 'Content-Type': 'application/json' } })));
    const view = renderAttachments();
    expect(await screen.findByRole('img', { name: '页面.png' })).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('link', { name: '下载 页面.png' })).toHaveAttribute('href', '/api/attachments/7/content');
    expect(screen.getByRole('link', { name: '下载 需求.pdf' })).toHaveAttribute('href', '/api/attachments/8/content');
    expect(view.container.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByText(/上传 \d+ 个附件|拖拽文件到此处/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览 页面.png' }));
    expect(screen.getByRole('dialog', { name: '页面.png' })).toBeInTheDocument();
  });

  it('没有附件时隐藏整个附件区域', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ attachments: [] }), { headers: { 'Content-Type': 'application/json' } })));
    const { container } = renderAttachments();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
