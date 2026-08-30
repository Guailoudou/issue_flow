import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../components/atoms/Alert';
import { Button } from '../components/atoms/Button';
import { FormField } from '../components/atoms/FormField';
import { Input } from '../components/atoms/Input';
import { Select } from '../components/atoms/Select';
import { ApiTokenSecretPanel } from '../components/molecules/ApiTokenSecretPanel';
import { EmptyState } from '../components/atoms/EmptyState';
import { ErrorPanel } from '../components/molecules/ErrorPanel';
import { PageHeader } from '../components/molecules/PageHeader';
import { Spinner } from '../components/atoms/Spinner';
import { api, jsonBody } from '../lib/api';
import { formatDate } from '../lib/format';
import type { ApiToken } from '../lib/types';

type CreatedToken = { token: string; apiToken: ApiToken };

export function ApiTokensPage() {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [secret, setSecret] = useState('');
  const query = useQuery({ queryKey: ['api-tokens'], queryFn: async () => (await api<{ tokens: ApiToken[] }>('/auth/api-tokens')).tokens });
  const create = useMutation({
    mutationFn: () => api<CreatedToken>('/auth/api-tokens', { method: 'POST', ...jsonBody({ name: name.trim(), expiresInDays: expiresInDays === 'never' ? null : Number(expiresInDays) }) }),
    onSuccess: (result) => { setSecret(result.token); setName(''); void client.invalidateQueries({ queryKey: ['api-tokens'] }); },
  });
  const revoke = useMutation({ mutationFn: (id: number) => api(`/auth/api-tokens/${id}`, { method: 'DELETE' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['api-tokens'] }) });
  return <div className="page-container"><PageHeader title="API Token" description="创建用于脚本、自动化和外部系统调用 IssueFlow API 的个人凭据" />
    <div className="space-y-5">
      {secret && <ApiTokenSecretPanel token={secret} onDismiss={() => setSecret('')} />}
      <section className="surface p-4 sm:p-5"><h2 className="font-semibold text-slate-900">创建 Token</h2><p className="mt-1 text-sm text-slate-600">Token 继承你的全部账户权限，请像密码一样妥善保管。</p>
        <form className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}>
          <FormField label="名称" htmlFor="api-token-name" required hint="例如：CI 发布脚本"><Input id="api-token-name" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></FormField>
          <FormField label="有效期" htmlFor="api-token-expiry"><Select id="api-token-expiry" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}><option value="30">30 天</option><option value="90">90 天</option><option value="365">365 天</option><option value="never">永不过期</option></Select></FormField>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()} icon={<Plus className="size-4" aria-hidden="true" />}>创建 Token</Button>
        </form>{create.error && <div className="mt-3"><Alert message={create.error.message} /></div>}
      </section>
      <section className="surface overflow-hidden"><div className="border-b px-4 py-3"><h2 className="font-semibold text-slate-900">现有 Token</h2><p className="mt-1 text-sm text-slate-600">最多可保留 20 个；撤销后立即失效。</p></div>
        {query.isPending ? <Spinner label="正在加载 API Token" /> : query.isError ? <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /> : query.data.length === 0 ? <EmptyState icon={KeyRound} title="暂无 API Token" description="创建一个 Token 后即可通过 Bearer 认证调用 API。" /> : <ul className="divide-y">{query.data.map((token) => <li key={token.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-slate-900">{token.name}</strong><code className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{token.prefix}…</code></div><p className="mt-1 text-xs text-slate-500">创建于 {formatDate(token.createdAt)} · 过期时间 {token.expiresAt ? formatDate(token.expiresAt) : '永不过期'} · 最近使用 {formatDate(token.lastUsedAt)}</p></div><Button type="button" variant="ghost" loading={revoke.isPending && revoke.variables === token.id} icon={<Trash2 className="size-4 text-red-600" aria-hidden="true" />} onClick={() => window.confirm(`确认撤销 API Token“${token.name}”？撤销后无法恢复。`) && revoke.mutate(token.id)}>撤销</Button></li>)}</ul>}
        {revoke.error && <div className="m-4"><Alert message={revoke.error.message} /></div>}
      </section>
    </div>
  </div>;
}
