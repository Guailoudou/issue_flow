import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, File, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { IssueAttachment } from '../../lib/types';
import { Alert } from '../atoms/Alert';
import { Modal } from '../atoms/Modal';
import { Spinner } from '../atoms/Spinner';
import { isPreviewableAttachment } from '../molecules/AttachmentPicker';
import { ErrorPanel } from '../molecules/ErrorPanel';

const formatSize = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(size / 1024)} KiB`;

export function IssueAttachments({ issueId }: { issueId: number }) {
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<IssueAttachment | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['issue-attachments', issueId], queryFn: () => api<{ attachments: IssueAttachment[] }>(`/issues/${issueId}/attachments`) });
  const remove = useMutation({ mutationFn: (id: number) => api<void>(`/attachments/${id}`, { method: 'DELETE' }), onSuccess: () => { setFeedback(null); void client.invalidateQueries({ queryKey: ['issue-attachments', issueId] }); void client.invalidateQueries({ queryKey: ['issue'] }); }, onError: (error: Error) => setFeedback(error.message) });
  if (query.isPending) return <div className="surface"><Spinner label="正在加载附件" /></div>;
  if (query.isError) return <div className="surface"><ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /></div>;
  const attachments = query.data.attachments;
  if (!attachments.length) return null;
  return <section className="surface overflow-hidden" aria-labelledby="issue-attachments-title">
    <header className={`${expanded ? 'border-b' : ''} bg-slate-50`}><h2 id="issue-attachments-title"><button type="button" className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-100" aria-expanded={expanded} aria-controls="issue-attachments-content" onClick={() => setExpanded((value) => !value)}><span><span className="block font-semibold">附件</span><span className="mt-0.5 block text-sm font-normal text-slate-500" role="status" aria-atomic="true">共有 {attachments.length} 个附件</span></span><ChevronDown className={`size-5 shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" /></button></h2></header>
    {expanded && <div id="issue-attachments-content" className="p-4">
      {feedback && <div className="mb-4"><Alert message={feedback} /></div>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="已上传附件">
        {attachments.map((attachment) => {
          const previewable = isPreviewableAttachment(attachment.mimeType);
          return <li key={attachment.id} className="min-w-0 overflow-hidden rounded-lg border bg-white">
            {previewable ? <button type="button" className="block aspect-[4/3] w-full overflow-hidden bg-slate-100" onClick={() => setSelected(attachment)} aria-label={`预览 ${attachment.fileName}`}><img src={attachment.url} alt={attachment.fileName} loading="lazy" className="size-full object-cover transition-opacity hover:opacity-90" /></button> : <div className="flex aspect-[4/3] items-center justify-center bg-slate-100"><File className="size-12 text-slate-400" aria-hidden="true" /></div>}
            <div className="space-y-1 p-2"><p className="truncate text-sm font-medium" title={attachment.fileName}>{attachment.fileName}</p><p className="text-xs text-slate-500">{formatSize(attachment.size)} · {attachment.uploader.displayName} · {formatDate(attachment.createdAt)}</p><div className="flex flex-wrap gap-1"><a href={attachment.url} download={attachment.fileName} className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50" aria-label={`下载 ${attachment.fileName}`}><Download className="size-4" aria-hidden="true" />下载</a>{attachment.canDelete && <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50" aria-label={`删除 ${attachment.fileName}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`确定删除“${attachment.fileName}”吗？`)) remove.mutate(attachment.id); }}><Trash2 className="size-4" aria-hidden="true" />删除</button>}</div></div>
          </li>;
        })}
      </ul>
    </div>}
    <Modal open={!!selected} title={selected?.fileName || '图片预览'} onClose={() => setSelected(null)}>{selected && <div className="space-y-4"><div className="overflow-hidden rounded-lg bg-slate-100"><img src={selected.url} alt={selected.fileName} className="max-h-[70vh] w-full object-contain" /></div><div className="flex justify-end"><a href={selected.url} download={selected.fileName} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700"><Download className="size-4" aria-hidden="true" />下载附件</a></div></div>}</Modal>
  </section>;
}
