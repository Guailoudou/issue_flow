import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '../../components/atoms/Alert';
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
import type { OssSettingResponse } from '../../lib/types';

type StorageMode = 'LOCAL' | 'S3' | 'WEBDAV';
const initialForm = {
  storageMode: 'LOCAL' as StorageMode, endpoint: '', region: '', bucket: '', prefix: 'issueflow/attachments', forcePathStyle: false,
  accessKeyId: '', accessKeySecret: '', clearCredentials: false, webdavUrl: '', webdavPath: 'issueflow/attachments',
  webdavUsername: '', webdavPassword: '', clearWebdavCredentials: false,
};

export function AdminOssPage() {
  const [form, setForm] = useState(initialForm);
  const query = useQuery({ queryKey: ['admin-storage'], queryFn: () => api<OssSettingResponse>('/admin/storage/oss') });
  useEffect(() => {
    if (query.data) setForm({ ...query.data.setting, accessKeyId: '', accessKeySecret: '', clearCredentials: false, webdavUsername: '', webdavPassword: '', clearWebdavCredentials: false });
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => api<OssSettingResponse>('/admin/storage/oss', { method: 'PUT', ...jsonBody({
      storageMode: form.storageMode, endpoint: form.endpoint.trim(), region: form.region.trim(), bucket: form.bucket.trim(), prefix: form.prefix.trim(), forcePathStyle: form.forcePathStyle,
      clearCredentials: form.clearCredentials, webdavUrl: form.webdavUrl.trim(), webdavPath: form.webdavPath.trim(), clearWebdavCredentials: form.clearWebdavCredentials,
      ...(form.accessKeyId.trim() && { accessKeyId: form.accessKeyId.trim() }), ...(form.accessKeySecret.trim() && { accessKeySecret: form.accessKeySecret.trim() }),
      ...(form.webdavUsername.trim() && { webdavUsername: form.webdavUsername.trim() }), ...(form.webdavPassword && { webdavPassword: form.webdavPassword }),
    }) }),
    onSuccess: async () => { setForm((value) => ({ ...value, accessKeyId: '', accessKeySecret: '', clearCredentials: false, webdavUsername: '', webdavPassword: '', clearWebdavCredentials: false })); await query.refetch(); },
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>(form.storageMode === 'WEBDAV' ? '/admin/storage/webdav/test' : '/admin/storage/oss/test', { method: 'POST' }),
    onSuccess: () => void query.refetch(),
  });
  if (query.isPending) return <Spinner label="正在加载附件存储配置" />;
  if (query.isError) return <div className="surface"><ErrorPanel title="无法加载附件存储配置" message={query.error.message} onRetry={() => void query.refetch()} /></div>;
  const setting = query.data.setting;
  const pending = save.isPending || test.isPending;
  const valid = form.storageMode === 'LOCAL' || (form.storageMode === 'S3' ? form.endpoint.trim() && form.bucket.trim() && form.prefix.trim() : form.webdavUrl.trim() && form.webdavPath.trim());
  const clearConfirmed = () => (!form.clearCredentials && !form.clearWebdavCredentials) || window.confirm('确认清除已保存的存储凭据？清除后不可恢复。');

  return <>
    <PageHeader title="附件存储" description="本地、S3 与 WebDAV 三种模式互斥，新附件只写入当前选择的存储" />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <form className="surface min-w-0 space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); if (clearConfirmed()) save.mutate(); }}>
        {save.error && <Alert message={save.error.message} />}{save.isSuccess && <Alert variant="success" message="附件存储配置已保存" />}
        <FormField label="当前存储模式" htmlFor="storage-mode" required><Select id="storage-mode" value={form.storageMode} onChange={(event) => setForm({ ...form, storageMode: event.target.value as StorageMode })}><option value="LOCAL">服务器本地</option><option value="S3">S3 兼容存储</option><option value="WEBDAV">WebDAV</option></Select></FormField>

        {form.storageMode === 'S3' && <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Endpoint" htmlFor="oss-endpoint" required><Input id="oss-endpoint" type="url" placeholder="https://s3.example.com" value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} /></FormField>
          <FormField label="Region" htmlFor="oss-region" hint="可选；留空使用 us-east-1"><Input id="oss-region" value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} /></FormField>
          <FormField label="Bucket" htmlFor="oss-bucket" required><Input id="oss-bucket" value={form.bucket} onChange={(event) => setForm({ ...form, bucket: event.target.value })} /></FormField>
          <FormField label="对象前缀" htmlFor="oss-prefix" required><Input id="oss-prefix" value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })} /></FormField>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 md:col-span-2"><Checkbox checked={form.forcePathStyle} onChange={(event) => setForm({ ...form, forcePathStyle: event.target.checked })} /><span className="text-sm">强制路径寻址（MinIO 和部分兼容服务需要）</span></label>
          <FormField label="AccessKey ID" htmlFor="oss-access-key-id" hint={setting.hasAccessKeyId ? '已配置；留空保留原值' : undefined}><Input id="oss-access-key-id" type="password" autoComplete="new-password" value={form.accessKeyId} onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })} /></FormField>
          <FormField label="AccessKey Secret" htmlFor="oss-access-key-secret" hint={setting.hasAccessKeySecret ? '已配置；留空保留原值' : undefined}><Input id="oss-access-key-secret" type="password" autoComplete="new-password" value={form.accessKeySecret} onChange={(event) => setForm({ ...form, accessKeySecret: event.target.value })} /></FormField>
        </div>}

        {form.storageMode === 'WEBDAV' && <div className="grid gap-4 md:grid-cols-2">
          <FormField label="WebDAV 地址" htmlFor="webdav-url" hint="服务根地址，不含附件目录" required><Input id="webdav-url" type="url" placeholder="https://dav.example.com/files/user" value={form.webdavUrl} onChange={(event) => setForm({ ...form, webdavUrl: event.target.value })} /></FormField>
          <FormField label="附件目录" htmlFor="webdav-path" required><Input id="webdav-path" value={form.webdavPath} onChange={(event) => setForm({ ...form, webdavPath: event.target.value })} /></FormField>
          <FormField label="用户名" htmlFor="webdav-username" hint={setting.hasWebdavUsername ? '已配置；留空保留原值' : undefined}><Input id="webdav-username" autoComplete="username" value={form.webdavUsername} onChange={(event) => setForm({ ...form, webdavUsername: event.target.value })} /></FormField>
          <FormField label="密码" htmlFor="webdav-password" hint={setting.hasWebdavPassword ? '已配置；留空保留原值' : undefined}><Input id="webdav-password" type="password" autoComplete="new-password" value={form.webdavPassword} onChange={(event) => setForm({ ...form, webdavPassword: event.target.value })} /></FormField>
        </div>}

        {form.storageMode === 'LOCAL' && <Alert variant="success" message="新附件将保存在服务器本地；已有附件仍从原存储读取。" />}
        <div className="grid gap-3 md:grid-cols-2">
          <ClearCredential checked={form.clearCredentials} disabled={form.storageMode === 'S3' || (!setting.hasAccessKeyId && !setting.hasAccessKeySecret)} label="清除 S3 凭据" onChange={(checked) => setForm({ ...form, clearCredentials: checked })} />
          <ClearCredential checked={form.clearWebdavCredentials} disabled={form.storageMode === 'WEBDAV' || (!setting.hasWebdavUsername && !setting.hasWebdavPassword)} label="清除 WebDAV 凭据" onChange={(checked) => setForm({ ...form, clearWebdavCredentials: checked })} />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">{setting.updatedAt ? `上次更新：${formatDate(setting.updatedAt)}` : '尚未保存配置'}</p><Button type="submit" loading={save.isPending} disabled={pending || !valid} icon={<Save className="size-4" />}>保存配置</Button></div>
      </form>
      <aside className="surface h-fit p-5"><h2 className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4 text-brand-700" aria-hidden="true" />连接检查</h2><p className="mt-2 text-sm text-slate-600">保存远程配置后，测试当前存储的读写权限。切换模式只影响新附件。</p>{test.error && <div className="mt-3"><Alert message={test.error.message} /></div>}{test.data && <div className="mt-3"><Alert variant="success" message={test.data.message} /></div>}{setting.lastTestedAt && <p className="mt-3 text-xs text-slate-500">最近检查：{formatDate(setting.lastTestedAt)}{setting.lastTestMessage ? ` · ${setting.lastTestMessage}` : ''}</p>}<Button type="button" className="mt-4 w-full" variant="secondary" loading={test.isPending} disabled={pending || form.storageMode === 'LOCAL' || form.storageMode !== setting.storageMode} icon={<FlaskConical className="size-4" />} onClick={() => test.mutate()}>测试当前存储</Button></aside>
    </div>
  </>;
}

function ClearCredential({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className={`flex min-h-11 items-center gap-3 rounded-lg border p-3 text-sm ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}><Checkbox checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
