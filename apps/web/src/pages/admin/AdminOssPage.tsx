import { useMutation, useQuery } from '@tanstack/react-query';
import { Cloud, FlaskConical, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '../../components/atoms/Alert';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Checkbox } from '../../components/atoms/Checkbox';
import { FormField } from '../../components/atoms/FormField';
import { Input } from '../../components/atoms/Input';
import { Spinner } from '../../components/atoms/Spinner';
import { ErrorPanel } from '../../components/molecules/ErrorPanel';
import { PageHeader } from '../../components/molecules/PageHeader';
import { api, jsonBody } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { OssSettingResponse } from '../../lib/types';

const initialForm = { enabled: false, endpoint: '', region: 'us-east-1', bucket: '', prefix: 'issueflow/attachments', forcePathStyle: false, accessKeyId: '', accessKeySecret: '' };

export function AdminOssPage() {
  const [form, setForm] = useState(initialForm);
  const query = useQuery({ queryKey: ['admin-oss'], queryFn: () => api<OssSettingResponse>('/admin/storage/oss') });
  useEffect(() => {
    if (!query.data) return;
    setForm({ ...query.data.setting, accessKeyId: '', accessKeySecret: '' });
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => api<OssSettingResponse>('/admin/storage/oss', { method: 'PUT', ...jsonBody({
      enabled: form.enabled, endpoint: form.endpoint.trim(), region: form.region.trim(), bucket: form.bucket.trim(), prefix: form.prefix.trim(), forcePathStyle: form.forcePathStyle,
      ...(form.accessKeyId.trim() ? { accessKeyId: form.accessKeyId.trim() } : {}),
      ...(form.accessKeySecret.trim() ? { accessKeySecret: form.accessKeySecret.trim() } : {}),
    }) }),
    onSuccess: async () => { setForm((value) => ({ ...value, accessKeyId: '', accessKeySecret: '' })); await query.refetch(); },
  });
  const testConnection = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>('/admin/storage/oss/test', { method: 'POST' }),
    onSuccess: () => void query.refetch(),
  });

  if (query.isPending) return <Spinner label="正在加载 S3 配置" />;
  if (query.isError) return <div className="surface"><ErrorPanel title="无法加载 S3 配置" message={query.error.message} onRetry={() => void query.refetch()} /></div>;
  const setting = query.data.setting;
  const pending = save.isPending || testConnection.isPending;
  const valid = form.endpoint.trim() && form.region.trim() && form.bucket.trim() && form.prefix.trim();

  return <>
    <PageHeader title="S3 兼容存储" description="连接 AWS S3、阿里云 OSS、MinIO 等 S3 兼容对象存储" />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <form className="surface min-w-0 space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div><h2 className="font-semibold">存储配置</h2><p className="mt-1 text-sm text-slate-500">AccessKey 保存后不会返回明文。</p></div>
          <div className="flex gap-2"><Badge>{setting.hasAccessKeyId ? 'AccessKey ID 已配置' : 'AccessKey ID 未配置'}</Badge><Badge>{setting.hasAccessKeySecret ? 'Secret 已配置' : 'Secret 未配置'}</Badge></div>
        </div>
        {save.error && <Alert message={save.error.message} />}
        {save.isSuccess && <Alert variant="success" message="S3 配置已保存" />}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50">
          <Checkbox checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          <span><span className="block text-sm font-semibold">启用 S3 存储</span><span className="block text-xs text-slate-500">仅影响保存配置后新上传的附件。</span></span>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Endpoint" htmlFor="oss-endpoint" hint="例如 https://s3.amazonaws.com 或服务商兼容地址" required><Input id="oss-endpoint" type="url" value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} /></FormField>
          <FormField label="Region" htmlFor="oss-region" hint="例如 us-east-1、cn-hangzhou" required><Input id="oss-region" value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} /></FormField>
          <FormField label="Bucket" htmlFor="oss-bucket" required><Input id="oss-bucket" value={form.bucket} onChange={(event) => setForm({ ...form, bucket: event.target.value })} /></FormField>
          <FormField label="对象前缀" htmlFor="oss-prefix" hint="附件对象在 Bucket 中的目录前缀" required><Input id="oss-prefix" value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })} /></FormField>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50 md:col-span-2"><Checkbox checked={form.forcePathStyle} onChange={(event) => setForm({ ...form, forcePathStyle: event.target.checked })} /><span><span className="block text-sm font-semibold">强制路径寻址</span><span className="block text-xs text-slate-500">MinIO 等服务可能需要开启；阿里云 OSS 请保持关闭。</span></span></label>
          <FormField label="AccessKey ID" htmlFor="oss-access-key-id" hint={setting.hasAccessKeyId ? '已配置；留空将保留原值' : undefined}><Input id="oss-access-key-id" type="password" autoComplete="new-password" value={form.accessKeyId} onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })} /></FormField>
          <FormField label="AccessKey Secret" htmlFor="oss-access-key-secret" hint={setting.hasAccessKeySecret ? '已配置；留空将保留原值' : undefined}><Input id="oss-access-key-secret" type="password" autoComplete="new-password" value={form.accessKeySecret} onChange={(event) => setForm({ ...form, accessKeySecret: event.target.value })} /></FormField>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">{setting.updatedAt ? `上次更新：${formatDate(setting.updatedAt)}` : '尚未保存配置'}</p>
          <Button type="submit" loading={save.isPending} disabled={pending || !valid} icon={<Save className="size-4" />}>保存配置</Button>
        </div>
      </form>
      <aside className="space-y-5">
        <section className="surface p-5" aria-labelledby="oss-test-heading">
          <h2 id="oss-test-heading" className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4 text-brand-700" aria-hidden="true" />连接检查</h2>
          <p className="mt-2 text-sm text-slate-600">保存后检查凭据是否可访问目标 Bucket。</p>
          {testConnection.error && <div className="mt-3"><Alert message={testConnection.error.message} /></div>}
          {testConnection.data && <div className="mt-3"><Alert variant="success" message={testConnection.data.message} /></div>}
          {setting.lastTestedAt && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600" role="status"><p>最近检查：{formatDate(setting.lastTestedAt)}</p>{setting.lastTestMessage && <p className="mt-1 break-words">{setting.lastTestMessage}</p>}</div>}
          <Button type="button" className="mt-4 w-full" variant="secondary" loading={testConnection.isPending} disabled={pending || !setting.hasAccessKeyId || !setting.hasAccessKeySecret} icon={<FlaskConical className="size-4" />} onClick={() => testConnection.mutate()}>测试连接</Button>
        </section>
        <section className="surface p-5"><h2 className="flex items-center gap-2 font-semibold"><Cloud className="size-4 text-brand-700" aria-hidden="true" />存储规则</h2><p className="mt-2 text-sm text-slate-600">配置前附件保留在服务器本地；启用后上传到 S3 兼容存储。下载地址和权限校验保持不变。</p></section>
      </aside>
    </div>
  </>;
}
