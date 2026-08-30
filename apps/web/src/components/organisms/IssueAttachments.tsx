import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, File, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { IssueAttachment } from '../../lib/types';
import { Alert } from '../atoms/Alert';
import { Button } from '../atoms/Button';
import { Modal } from '../atoms/Modal';
import { Spinner } from '../atoms/Spinner';
import { AttachmentPicker, isPreviewableAttachment } from '../molecules/AttachmentPicker';
import { ErrorPanel } from '../molecules/ErrorPanel';

const formatSize = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(size / 1024)} KiB`;

export function IssueAttachments({ issueId }: { issueId: number }) {
  const client = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState<IssueAttachment | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; success?: boolean } | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const query = useQuery({ queryKey: ['issue-attachments', issueId], queryFn: () => api<{ attachments: IssueAttachment[] }>(`/issues/${issueId}/attachments`) });
  const upload = useMutation({ mutationFn: async (attachments: File[]) => {
    const failed: string[] = []; setProgress({ done: 0, total: attachments.length });
    for (let index = 0; index < attachments.length; index += 1) {
      const body = new FormData(); body.append('file', attachments[index]);
      try { await api(`/issues/${issueId}/attachments`, { method: 'POST', body }); } catch { failed.push(attachments[index].name); }
      setProgress({ done: index + 1, total: attachments.length });
    }
    return failed;
  }, onSuccess: (failed) => { setFiles([]); setFeedback(failed.length ? { message: `${failed.length} 个附件上传失败：${failed.join('、')}` } : { message: '附件上传成功', success: true }); void client.invalidateQueries({ queryKey: ['issue-attachments', issueId] }); void client.invalidateQueries({ queryKey: ['issue'] }); } });
  const remove = useMutation({ mutationFn: (id: number) => api<void>(`/attachments/${id}`, { method: 'DELETE' }), onSuccess: () => { setFeedback({ message: '附件已删除', success: true }); void client.invalidateQueries({ queryKey: ['issue-attachments', issueId] }); void client.invalidateQueries({ queryKey: ['issue'] }); }, onError: (error: Error) => setFeedback({ message: error.message }) });
  const attachments = query.data?.attachments ?? [];
  return <section className="surface overflow-hidden" aria-labelledby="issue-attachments-title">
    <header className="border-b bg-slate-50 px-4 py-3"><h2 id="issue-attachments-title" className="font-semibold">附件</h2><p className="mt-0.5 text-sm text-slate-500">上传截图、文档、压缩包或其他相关文件</p></header>
    <div className="space-y-4 p-4">
      {feedback && <Alert message={feedback.message} variant={feedback.success ? 'success' : 'error'} />}
      <AttachmentPicker value={files} onChange={setFiles} disabled={upload.isPending} existingCount={attachments.length} />
      {files.length > 0 && <div className="flex flex-wrap items-center gap-3"><Button type="button" loading={upload.isPending} icon={<Upload className="size-4" aria-hidden="true" />} onClick={() => upload.mutate(files)}>上传 {files.length} 个附件</Button>{upload.isPending && <span role="status" className="text-sm text-slate-600">正在上传 {progress.done}/{progress.total}</span>}</div>}
      {query.isPending ? <Spinner label="正在加载附件" /> : query.isError ? <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /> : attachments.length > 0 ? <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="已上传附件">
        {attachments.map((attachment) => {
          const previewable = isPreviewableAttachment(attachment.mimeType);
          return <li key={attachment.id} className="min-w-0 overflow-hidden rounded-lg border bg-white">
            {previewable ? <button type="button" className="block aspect-[4/3] w-full overflow-hidden bg-slate-100" onClick={() => setSelected(attachment)} aria-label={`预览 ${attachment.fileName}`}><img src={attachment.url} alt={attachment.fileName} loading="lazy" className="size-full object-cover transition-opacity hover:opacity-90" /></button> : <div className="flex aspect-[4/3] items-center justify-center bg-slate-100"><File className="size-12 text-slate-400" aria-hidden="true" /></div>}
            <div className="space-y-1 p-2"><p className="truncate text-sm font-medium" title={attachment.fileName}>{attachment.fileName}</p><p className="text-xs text-slate-500">{formatSize(attachment.size)} · {attachment.uploader.displayName} · {formatDate(attachment.createdAt)}</p><div className="flex flex-wrap gap-1"><a href={attachment.url} download={attachment.fileName} className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50" aria-label={`下载 ${attachment.fileName}`}><Download className="size-4" aria-hidden="true" />下载</a>{attachment.canDelete && <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50" aria-label={`删除 ${attachment.fileName}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`确定删除“${attachment.fileName}”吗？`)) remove.mutate(attachment.id); }}><Trash2 className="size-4" aria-hidden="true" />删除</button>}</div></div>
          </li>;
        })}
      </ul> : null}
    </div>
    <Modal open={!!selected} title={selected?.fileName || '图片预览'} onClose={() => setSelected(null)}>{selected && <div className="space-y-4"><div className="overflow-hidden rounded-lg bg-slate-100"><img src={selected.url} alt={selected.fileName} className="max-h-[70vh] w-full object-contain" /></div><div className="flex justify-end"><a href={selected.url} download={selected.fileName} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700"><Download className="size-4" aria-hidden="true" />下载附件</a></div></div>}</Modal>
  </section>;
}
