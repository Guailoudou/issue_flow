import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '../../components/atoms/Alert';
import { Button } from '../../components/atoms/Button';
import { Checkbox } from '../../components/atoms/Checkbox';
import { FormField } from '../../components/atoms/FormField';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { Spinner } from '../../components/atoms/Spinner';
import { ErrorPanel } from '../../components/molecules/ErrorPanel';
import { PageHeader } from '../../components/molecules/PageHeader';
import { api, jsonBody } from '../../lib/api';

type SettingsForm = {
  name: string; description: string; logoUrl: string; defaultPageSize: number; allowUserCreateIssue: boolean;
  aiEnabled: boolean; aiUrl: string; aiModel: string; aiApiKey: string; clearAiApiKey: boolean; aiMaxLabels: number; aiTimeoutSeconds: number; aiStructuredOutput: boolean; aiDisableThinking: boolean;
};
type SettingsResponse = Omit<SettingsForm, 'aiApiKey' | 'clearAiApiKey'> & { hasAiApiKey: boolean };
const empty: SettingsForm = { name: 'IssueFlow', description: '', logoUrl: '', defaultPageSize: 20, allowUserCreateIssue: true, aiEnabled: false, aiUrl: '', aiModel: '', aiApiKey: '', clearAiApiKey: false, aiMaxLabels: 3, aiTimeoutSeconds: 60, aiStructuredOutput: false, aiDisableThinking: false };

export function AdminSettingsPage() {
  const client = useQueryClient();
  const [form, setForm] = useState(empty);
  const query = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<SettingsResponse>('/admin/settings') });
  useEffect(() => { if (query.data) setForm({ ...query.data, aiApiKey: '', clearAiApiKey: false }); }, [query.data]);
  const save = useMutation({
    mutationFn: () => api<SettingsResponse>('/admin/settings', { method: 'PUT', ...jsonBody({
      ...form,
      aiUrl: form.aiUrl.trim(), aiModel: form.aiModel.trim(), clearAiApiKey: form.clearAiApiKey,
      ...(form.aiApiKey.trim() ? { aiApiKey: form.aiApiKey.trim() } : { aiApiKey: undefined }),
    }) }),
    onSuccess: (data) => { client.setQueryData(['admin-settings'], data); setForm({ ...data, aiApiKey: '', clearAiApiKey: false }); void client.invalidateQueries({ queryKey: ['platform-settings-public'] }); },
  });
  if (query.isPending) return <Spinner label="正在加载平台设置" />;
  if (query.isError) return <div className="surface"><ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /></div>;
  const valid = !!form.name.trim() && form.defaultPageSize >= 5 && form.defaultPageSize <= 100 && form.aiMaxLabels >= 1 && form.aiMaxLabels <= 5 && form.aiTimeoutSeconds >= 5 && form.aiTimeoutSeconds <= 300 && (!form.aiEnabled || (!!form.aiUrl.trim() && !!form.aiModel.trim()));
  return <>
    <PageHeader title="平台设置" description="配置平台品牌、创建权限和 AI 自动标签" />
    <form className="surface max-w-3xl space-y-6 p-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      {save.error && <Alert message={save.error.message} />}{save.isSuccess && <Alert variant="success" message="平台设置已保存" />}
      <section className="space-y-5" aria-labelledby="platform-settings-heading">
        <div className="border-b pb-3"><h2 id="platform-settings-heading" className="font-semibold">基础设置</h2></div>
        <FormField label="平台名称" htmlFor="platform-name" required><Input id="platform-name" maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FormField>
        <FormField label="平台描述" htmlFor="platform-description"><Textarea id="platform-description" maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></FormField>
        <FormField label="Logo URL" htmlFor="platform-logo" hint="留空将使用默认文本标识"><Input id="platform-logo" type="url" value={form.logoUrl} onChange={(event) => setForm({ ...form, logoUrl: event.target.value })} /></FormField>
        <FormField label="默认每页数量" htmlFor="platform-page-size" hint="可设置 5–100"><Input id="platform-page-size" type="number" min={5} max={100} value={form.defaultPageSize} onChange={(event) => setForm({ ...form, defaultPageSize: Number(event.target.value) })} /></FormField>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50"><Checkbox checked={form.allowUserCreateIssue} onChange={(event) => setForm({ ...form, allowUserCreateIssue: event.target.checked })} /><span><span className="block text-sm font-semibold">允许普通用户创建 Issue</span><span className="block text-xs text-slate-500">关闭后仅管理员可创建新 Issue</span></span></label>
      </section>
      <section className="space-y-5 border-t pt-5" aria-labelledby="ai-settings-heading">
        <div><h2 id="ai-settings-heading" className="flex items-center gap-2 font-semibold"><Bot className="size-4 text-brand-700" aria-hidden="true" />AI 自动标签</h2><p className="mt-1 text-sm text-slate-500">新建 Issue 未选择标签时，根据标题和正文自动匹配现有标签；不会发送附件或图片。</p></div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50"><Checkbox checked={form.aiEnabled} onChange={(event) => setForm({ ...form, aiEnabled: event.target.checked })} /><span><span className="block text-sm font-semibold">启用 AI 自动标签</span><span className="block text-xs text-slate-500">AI 请求失败不会影响 Issue 创建</span></span></label>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="AI URL" htmlFor="ai-url" hint="OpenAI Chat Completions 兼容接口的完整 URL" required={form.aiEnabled}><Input id="ai-url" type="url" placeholder="https://example.com/v1/chat/completions" value={form.aiUrl} onChange={(event) => setForm({ ...form, aiUrl: event.target.value })} /></FormField>
          <FormField label="模型名称" htmlFor="ai-model" required={form.aiEnabled}><Input id="ai-model" placeholder="例如模型 ID" maxLength={200} value={form.aiModel} onChange={(event) => setForm({ ...form, aiModel: event.target.value })} /></FormField>
          <FormField label="API Key" htmlFor="ai-api-key" hint={query.data.hasAiApiKey ? '已加密保存；留空将保留原密钥' : '无鉴权接口可留空'}><Input id="ai-api-key" type="password" autoComplete="new-password" disabled={form.clearAiApiKey} value={form.aiApiKey} onChange={(event) => setForm({ ...form, aiApiKey: event.target.value, clearAiApiKey: false })} /></FormField>
          <FormField label="最多标签数" htmlFor="ai-max-labels" hint="每个 Issue 自动添加 1–5 个标签"><Input id="ai-max-labels" type="number" min={1} max={5} value={form.aiMaxLabels} onChange={(event) => setForm({ ...form, aiMaxLabels: Number(event.target.value) })} /></FormField>
          <FormField label="请求超时（秒）" htmlFor="ai-timeout" hint="可设置 5–300 秒；后台执行，不影响 Issue 创建速度"><Input id="ai-timeout" type="number" min={5} max={300} value={form.aiTimeoutSeconds} onChange={(event) => setForm({ ...form, aiTimeoutSeconds: Number(event.target.value) })} /></FormField>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50"><Checkbox checked={form.aiStructuredOutput} onChange={(event) => setForm({ ...form, aiStructuredOutput: event.target.checked })} /><span><span className="block text-sm font-semibold">启用 JSON Schema 结构化输出</span><span className="block text-xs text-slate-500">仅在当前模型支持结构化输出时开启；关闭后不发送 response_format 参数。</span></span></label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50"><Checkbox checked={form.aiDisableThinking} onChange={(event) => setForm({ ...form, aiDisableThinking: event.target.checked })} /><span><span className="block text-sm font-semibold">关闭深度思考</span><span className="block text-xs text-slate-500">开启后发送 enable_thinking=false；仅用于支持该参数的模型。</span></span></label>
        {query.data.hasAiApiKey && <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50"><Checkbox checked={form.clearAiApiKey} onChange={(event) => setForm({ ...form, clearAiApiKey: event.target.checked, aiApiKey: '' })} /><span className="text-sm font-medium">清除已保存的 API Key</span></label>}
      </section>
      <div className="flex justify-end border-t pt-4"><Button type="submit" loading={save.isPending} disabled={!valid} icon={<Save className="size-4" aria-hidden="true" />}>保存设置</Button></div>
    </form>
  </>;
}
