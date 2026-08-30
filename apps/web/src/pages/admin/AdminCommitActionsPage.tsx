import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleDot, GitCommitHorizontal, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../components/atoms/Alert';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Checkbox } from '../../components/atoms/Checkbox';
import { FormField } from '../../components/atoms/FormField';
import { Input } from '../../components/atoms/Input';
import { Modal } from '../../components/atoms/Modal';
import { Select } from '../../components/atoms/Select';
import { Spinner } from '../../components/atoms/Spinner';
import { ErrorPanel } from '../../components/molecules/ErrorPanel';
import { PageHeader } from '../../components/molecules/PageHeader';
import { api, jsonBody } from '../../lib/api';
import type { IssueStatus, Label } from '../../lib/types';

type CommitAction = { id: number; name: string; keyword: string; state: IssueStatus | null; isSystem: boolean; labels: Array<{ label: Label }> };
type Form = { name: string; keyword: string; state: '' | IssueStatus; labelIds: number[] };
const empty: Form = { name: '', keyword: '', state: '', labelIds: [] };

export function AdminCommitActionsPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<CommitAction | null | undefined>(undefined);
  const [form, setForm] = useState(empty);
  const actions = useQuery({ queryKey: ['commit-actions'], queryFn: async () => (await api<{ items: CommitAction[] }>('/admin/commit-actions')).items });
  const labels = useQuery({ queryKey: ['labels'], queryFn: async () => (await api<{ items: Label[] }>('/labels')).items });
  const refresh = () => void client.invalidateQueries({ queryKey: ['commit-actions'] });
  const save = useMutation({
    mutationFn: () => api(editing ? `/admin/commit-actions/${editing.id}` : '/admin/commit-actions', { method: editing ? 'PUT' : 'POST', ...jsonBody({ ...form, keyword: form.keyword.toLowerCase(), state: form.state || null }) }),
    onSuccess: () => { refresh(); setEditing(undefined); },
  });
  const remove = useMutation({ mutationFn: (id: number) => api(`/admin/commit-actions/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const open = (action: CommitAction | null) => {
    setEditing(action);
    setForm(action ? { name: action.name, keyword: action.keyword, state: action.state ?? '', labelIds: action.labels.map(({ label }) => label.id) } : empty);
  };
  const toggleLabel = (labelId: number) => setForm((current) => ({ ...current, labelIds: current.labelIds.includes(labelId) ? current.labelIds.filter((id) => id !== labelId) : [...current.labelIds, labelId] }));
  const valid = !!form.name.trim() && /^[a-z][a-z_-]{0,15}$/i.test(form.keyword) && (!!form.state || form.labelIds.length > 0);

  return <>
    <PageHeader title="提交操作管理" description="通过提交信息中的指令更新 Issue 状态或添加标签" actions={<Button icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => open(null)}>新建操作</Button>} />
    {remove.error && <div className="mb-4"><Alert message={remove.error.message} /></div>}
    <section className="surface overflow-hidden">
      {actions.isPending ? <Spinner /> : actions.isError ? <ErrorPanel message={actions.error.message} onRetry={() => void actions.refetch()} /> : actions.data.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">暂无提交操作</p> : <ul className="divide-y">{actions.data.map((action) => <li key={action.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700"><GitCommitHorizontal className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{action.name}</h2>{action.isSystem && <Badge className="bg-slate-100 text-slate-700">系统默认</Badge>}<code className="rounded bg-slate-100 px-2 py-1 text-sm text-brand-900">#{action.keyword}{'{Issue编号}'}</code></div><div className="mt-2 flex flex-wrap gap-2">{action.state === 'OPEN' && <Badge className="bg-emerald-100 text-emerald-800"><CircleDot className="mr-1 size-3" aria-hidden="true" />设为开放</Badge>}{action.state === 'CLOSED' && <Badge className="bg-violet-100 text-violet-800"><CircleCheck className="mr-1 size-3" aria-hidden="true" />设为关闭</Badge>}{action.labels.map(({ label }) => <Badge key={label.id} color={label.color}><Tag className="mr-1 size-3" aria-hidden="true" />{label.name}</Badge>)}</div></div>
        <div className="flex gap-1"><Button variant="ghost" icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => open(action)}>编辑</Button>{!action.isSystem && <Button variant="ghost" icon={<Trash2 className="size-4 text-red-600" aria-hidden="true" />} loading={remove.isPending && remove.variables === action.id} onClick={() => window.confirm(`确认删除提交操作“${action.name}”？`) && remove.mutate(action.id)}>删除</Button>}</div>
      </li>)}</ul>}
    </section>
    <Modal open={editing !== undefined} title={editing ? '编辑提交操作' : '新建提交操作'} onClose={() => setEditing(undefined)}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        {save.error && <Alert message={save.error.message} />}
        <FormField label="操作名称" htmlFor="commit-action-name" required><Input id="commit-action-name" maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FormField>
        <FormField label="指令关键字" htmlFor="commit-action-keyword" hint="使用英文字母、下划线或连字符；提交时写作 #关键字Issue编号" required><Input id="commit-action-keyword" maxLength={16} placeholder="例如 qa" value={form.keyword} onChange={(event) => setForm({ ...form, keyword: event.target.value.replace(/^#/, '') })} /></FormField>
        <p className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-600">示例：<code className="font-semibold text-brand-900">#{form.keyword || 'qa'}4</code></p>
        <FormField label="Issue 状态" htmlFor="commit-action-state" hint="可不修改状态，仅添加标签"><Select id="commit-action-state" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value as Form['state'] })}><option value="">不修改状态</option><option value="OPEN">设为开放</option><option value="CLOSED">设为关闭</option></Select></FormField>
        <fieldset><legend className="text-sm font-semibold">添加标签</legend><p className="mt-1 text-xs text-slate-500">可不添加标签，仅修改状态；已存在的标签不会重复添加。</p><div className="mt-2 max-h-48 space-y-1 overflow-auto rounded-lg border p-2">{labels.isPending ? <Spinner label="正在加载标签" /> : labels.isError ? <p className="p-3 text-sm text-red-700" role="alert">标签加载失败：{labels.error.message}</p> : labels.data.length ? labels.data.map((label) => <label key={label.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 transition-colors hover:bg-slate-50"><Checkbox checked={form.labelIds.includes(label.id)} onChange={() => toggleLabel(label.id)} /><Badge color={label.color}>{label.name}</Badge></label>) : <p className="p-3 text-sm text-slate-500">暂无标签，请先在标签管理中创建。</p>}</div></fieldset>
        {!form.state && form.labelIds.length === 0 && <p className="text-sm text-amber-700" role="status">请至少选择一个状态操作或标签。</p>}
        <Button className="w-full" type="submit" loading={save.isPending} disabled={!valid}>保存提交操作</Button>
      </form>
    </Modal>
  </>;
}
