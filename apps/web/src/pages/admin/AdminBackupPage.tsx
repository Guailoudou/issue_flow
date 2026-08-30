import { useMutation } from '@tanstack/react-query';
import { DatabaseBackup, Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../components/atoms/Alert';
import { Button } from '../../components/atoms/Button';
import { FormField } from '../../components/atoms/FormField';
import { Input } from '../../components/atoms/Input';
import { PageHeader } from '../../components/molecules/PageHeader';
import { api } from '../../lib/api';
import { downloadApiFile } from '../../lib/download';

const CONFIRM_TEXT = '覆盖全部数据';

export function AdminBackupPage() {
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const exportBackup = useMutation({ mutationFn: () => downloadApiFile('/admin/backup/export', 'issueflow-backup.json') });
  const importBackup = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('backup', file!);
      return api<{ message: string }>('/admin/backup/import?confirm=OVERWRITE', { method: 'POST', body });
    },
  });

  return <>
    <PageHeader title="数据备份" description="导出或完整覆盖 IssueFlow 的平台数据与附件" />
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="surface space-y-4 p-5" aria-labelledby="backup-export-heading">
        <h2 id="backup-export-heading" className="flex items-center gap-2 font-semibold"><DatabaseBackup className="size-4 text-brand-700" aria-hidden="true" />导出全量备份</h2>
        <p className="text-sm text-slate-600">备份包含所有用户、Issue、评论、配置、API Token 哈希、加密凭据和附件内容。请按敏感文件妥善保管。</p>
        {exportBackup.error && <Alert message={exportBackup.error.message} />}
        <Button type="button" className="w-full" loading={exportBackup.isPending} icon={<Download className="size-4" />} onClick={() => exportBackup.mutate()}>下载全量备份</Button>
      </section>

      <section className="surface space-y-4 border-red-200 p-5" aria-labelledby="backup-import-heading">
        <h2 id="backup-import-heading" className="flex items-center gap-2 font-semibold text-red-800"><Upload className="size-4" aria-hidden="true" />覆盖导入</h2>
        <Alert message="导入会直接删除并覆盖当前平台全部数据，无法撤销。建议先导出当前数据并在维护时段操作。" />
        {importBackup.error && <Alert message={importBackup.error.message} />}{importBackup.data && <Alert variant="success" message="导入完成，平台数据已被备份内容覆盖。请重新载入页面。" />}
        <FormField label="IssueFlow 备份文件" htmlFor="backup-file" required><Input id="backup-file" type="file" accept="application/json,.json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></FormField>
        <FormField label={`输入“${CONFIRM_TEXT}”确认`} htmlFor="backup-confirmation" required><Input id="backup-confirmation" value={confirmation} autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} /></FormField>
        <Button type="button" variant="danger" className="w-full" loading={importBackup.isPending} disabled={!file || confirmation !== CONFIRM_TEXT || importBackup.isSuccess} icon={<Upload className="size-4" />} onClick={() => importBackup.mutate()}>覆盖导入全部数据</Button>
        {importBackup.isSuccess && <Button type="button" variant="secondary" className="w-full" onClick={() => window.location.assign('/')}>重新载入平台</Button>}
      </section>
    </div>
  </>;
}
