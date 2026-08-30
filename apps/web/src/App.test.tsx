import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './features/auth/AuthProvider';
describe('应用路由', () => { it('未登录访问受保护页面时跳转登录', async () => { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: '未登录' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }))); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/issues']}><AuthProvider><App /></AuthProvider></MemoryRouter></QueryClientProvider>); expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeInTheDocument(); vi.unstubAllGlobals(); }); });
