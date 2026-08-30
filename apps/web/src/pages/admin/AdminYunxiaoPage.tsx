import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical, KeyRound, Link2, Save, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '../../components/atoms/Alert';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Checkbox } from '../../components/atoms/Checkbox';
import { FormField } from '../../components/atoms/FormField';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { Spinner } from '../../components/atoms/Spinner';
import { ErrorPanel } from '../../components/molecules/ErrorPanel';
import { PageHeader } from '../../components/molecules/PageHeader';
import { api, jsonBody } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { YunxiaoEdition, YunxiaoIntegrationResponse } from '../../lib/types';

type YunxiaoForm = {
  enabled: boolean;
  edition: YunxiaoEdition;
  baseUrl: string;
  organizationId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryWebUrl: string;
  token: string;
  webhookSecret: string;
};

const emptyForm: YunxiaoForm = {
  enabled: false,
  edition: 'CENTRAL',
  baseUrl: 'https://openapi-rdc.aliyuncs.com',
  organizationId: '',
  repositoryId: '',
  repositoryName: '',
  repositoryWebUrl: '',
  token: '',
  webhookSecret: '',
};

function CredentialState({ configured, label }: { configured: boolean; label: string }) {
  return <Badge className={configured ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>{label}：{configured ? '已配置' : '未配置'}</Badge>;
}

export function AdminYunxiaoPage() {
  const [form, setForm] = useState<YunxiaoForm>(emptyForm);
  const query = useQuery({
    queryKey: ['admin-yunxiao'],
    queryFn: () => api<YunxiaoIntegrationResponse>('/admin/integrations/yunxiao'),
  });

  useEffect(() => {
    if (!query.data) return;
    const value = query.data.integration;
    setForm({
      enabled: value.enabled,
      edition: value.edition,
      baseUrl: value.baseUrl,
      organizationId: value.organizationId ?? '',
      repositoryId: value.repositoryId,
      repositoryName: value.repositoryName ?? '',
      repositoryWebUrl: value.repositoryWebUrl ?? '',
      token: '',
      webhookSecret: '',
    });
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => {
      const token = form.token.trim();
      const webhookSecret = form.webhookSecret.trim();
      return api<YunxiaoIntegrationResponse>('/admin/integrations/yunxiao', {
        method: 'PUT',
        ...jsonBody({
          enabled: form.enabled,
          edition: form.edition,
          baseUrl: form.baseUrl.trim(),
          organizationId: form.edition === 'CENTRAL' ? form.organizationId.trim() : '',
          repositoryId: form.repositoryId.trim(),
          repositoryName: form.repositoryName.trim(),
          repositoryWebUrl: form.repositoryWebUrl.trim(),
          ...(token ? { token } : {}),
          ...(webhookSecret ? { webhookSecret } : {}),
        }),
      });
    },
    onSuccess: async () => {
      setForm((current) => ({ ...current, token: '', webhookSecret: '' }));
      await query.refetch();
    },
  });
  const testConnection = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>('/admin/integrations/yunxiao/test', { method: 'POST' }),
    onSuccess: () => void query.refetch(),
  });
  const createWebhook = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string; webhookId?: string }>('/admin/integrations/yunxiao/create-webhook', { method: 'POST' }),
  });

  if (query.isPending) return <Spinner label="正在加载云效配置" />;
  if (query.isError) return <div className="surface"><ErrorPanel title="无法加载云效配置" message={query.error.message} onRetry={() => void query.refetch()} /></div>;
  const integration = query.data.integration;
  const actionPending = save.isPending || testConnection.isPending || createWebhook.isPending;
  const formValid = form.baseUrl.trim() && form.repositoryId.trim() && (form.edition === 'REGION' || form.organizationId.trim());

  return <>
    <PageHeader title="云效联动" description="连接 Codeup 仓库，让提交和合并请求自动关联 Issue" />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <form className="surface min-w-0 space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div>
            <h2 className="font-semibold">仓库配置</h2>
            <p className="mt-1 text-sm text-slate-500">访问令牌和 Secret 保存后不会返回明文。</p>
          </div>
          <div className="flex flex-wrap gap-2"><CredentialState configured={integration.hasToken} label="访问令牌" /><CredentialState configured={integration.hasWebhookSecret} label="Webhook Secret" /></div>
        </div>
        {save.error && <Alert message={save.error.message} />}
        {save.isSuccess && <Alert variant="success" message="云效配置已保存" />}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50">
          <Checkbox checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          <span><span className="block text-sm font-semibold">启用云效联动</span><span className="block text-xs text-slate-500">启用后接收 Codeup 的 Push 和合并请求事件</span></span>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="云效版本" htmlFor="yunxiao-edition" required>
            <Select id="yunxiao-edition" value={form.edition} onChange={(event) => setForm({ ...form, edition: event.target.value as YunxiaoEdition })}>
              <option value="CENTRAL">中心版</option><option value="REGION">Region 版</option>
            </Select>
          </FormField>
          <FormField label="服务地址" htmlFor="yunxiao-base-url" hint="填写 OpenAPI 域名，末尾无需斜杠" required>
            <Input id="yunxiao-base-url" type="url" value={form.baseUrl} placeholder="https://openapi-rdc.aliyuncs.com" onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
          </FormField>
          {form.edition === 'CENTRAL' && <FormField label="组织 ID" htmlFor="yunxiao-organization-id" required>
            <Input id="yunxiao-organization-id" value={form.organizationId} onChange={(event) => setForm({ ...form, organizationId: event.target.value })} />
          </FormField>}
          <FormField label="仓库 ID" htmlFor="yunxiao-repository-id" required>
            <Input id="yunxiao-repository-id" value={form.repositoryId} onChange={(event) => setForm({ ...form, repositoryId: event.target.value })} />
          </FormField>
          <FormField label="仓库名称" htmlFor="yunxiao-repository-name">
            <Input id="yunxiao-repository-name" value={form.repositoryName} placeholder="例如 issueflow" onChange={(event) => setForm({ ...form, repositoryName: event.target.value })} />
          </FormField>
          <FormField label="仓库页面 URL" htmlFor="yunxiao-repository-url">
            <Input id="yunxiao-repository-url" type="url" value={form.repositoryWebUrl} onChange={(event) => setForm({ ...form, repositoryWebUrl: event.target.value })} />
          </FormField>
          <FormField label="个人访问令牌" htmlFor="yunxiao-token" hint={integration.hasToken ? '已配置；留空将保留原令牌' : '用于测试连接和自动创建 Webhook'}>
            <Input id="yunxiao-token" type="password" autoComplete="new-password" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} />
          </FormField>
          <FormField label="Webhook Secret" htmlFor="yunxiao-webhook-secret" hint={integration.hasWebhookSecret ? '已配置；留空将保留原 Secret' : 'Codeup 回调请求的校验密钥'}>
            <Input id="yunxiao-webhook-secret" type="password" autoComplete="new-password" value={form.webhookSecret} onChange={(event) => setForm({ ...form, webhookSecret: event.target.value })} />
          </FormField>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">{integration.updatedAt ? `上次更新：${formatDate(integration.updatedAt)}` : '尚未保存配置'}</p>
          <Button type="submit" loading={save.isPending} disabled={actionPending || !formValid} icon={<Save className="size-4" />}>保存配置</Button>
        </div>
      </form>

      <aside className="space-y-5">
        <section className="surface p-5" aria-labelledby="connection-heading">
          <h2 id="connection-heading" className="flex items-center gap-2 font-semibold"><Link2 className="size-4 text-brand-700" aria-hidden="true" />连接检查</h2>
          <p className="mt-2 text-sm text-slate-600">保存配置后检查令牌是否能访问目标仓库。</p>
          {testConnection.error && <div className="mt-3"><Alert message={testConnection.error.message} /></div>}
          {testConnection.data && <div className="mt-3"><Alert variant={testConnection.data.ok ? 'success' : 'error'} message={testConnection.data.message} /></div>}
          {integration.lastTestedAt && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><p>最近检查：{formatDate(integration.lastTestedAt)}</p>{integration.lastTestMessage && <p className="mt-1 break-words">{integration.lastTestMessage}</p>}</div>}
          <Button type="button" className="mt-4 w-full" variant="secondary" loading={testConnection.isPending} disabled={actionPending || !integration.hasToken} icon={<FlaskConical className="size-4" />} onClick={() => testConnection.mutate()}>测试连接</Button>
        </section>
        <section className="surface p-5" aria-labelledby="webhook-heading">
          <h2 id="webhook-heading" className="flex items-center gap-2 font-semibold"><Webhook className="size-4 text-brand-700" aria-hidden="true" />Webhook</h2>
          <p className="mt-2 text-sm text-slate-600">可自动创建，也可在 Codeup 仓库设置中手动填写。</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="min-w-0"><dt className="font-medium">回调 URL</dt><dd className="mt-1 min-w-0 break-words rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-700 [overflow-wrap:anywhere]">{query.data.webhook.url}</dd></div>
            <div><dt className="font-medium">订阅事件</dt><dd className="mt-1 flex flex-wrap gap-2">{query.data.webhook.events.map((event) => <Badge key={event} className="border-slate-200 bg-slate-50 text-slate-700">{event}</Badge>)}</dd></div>
            <div><dt className="font-medium">校验密钥</dt><dd className="mt-1 text-slate-600">填写与上方 Webhook Secret 相同的值。</dd></div>
          </dl>
          {createWebhook.error && <div className="mt-3"><Alert message={createWebhook.error.message} /></div>}
          {createWebhook.data && <div className="mt-3"><Alert variant={createWebhook.data.ok ? 'success' : 'error'} message={createWebhook.data.message} /></div>}
          <Button type="button" className="mt-4 w-full" loading={createWebhook.isPending} disabled={actionPending || !integration.hasToken || !integration.hasWebhookSecret} icon={<KeyRound className="size-4" />} onClick={() => createWebhook.mutate()}>自动创建 Webhook</Button>
        </section>
      </aside>
    </div>
  </>;
}
