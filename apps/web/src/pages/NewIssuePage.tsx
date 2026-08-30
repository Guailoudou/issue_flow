import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/atoms/Spinner';
import { PageHeader } from '../components/molecules/PageHeader';
import { IssueForm, type IssueFormValues } from '../components/organisms/IssueForm';
import { useIssueMetadata } from '../features/issues/useIssueMetadata';
import { api, jsonBody } from '../lib/api';
import type { Issue, IssueAttachment } from '../lib/types';
import { removePendingImage, replacePendingImage, stripPendingImages } from '../lib/markdownImages';

async function createIssueWithAttachments(values: IssueFormValues) {
  const { attachments, ...fields } = values;
  let issue = await api<Issue>('/issues', { method: 'POST', ...jsonBody({ ...fields, body: stripPendingImages(fields.body), milestoneId: fields.milestoneId || null }) });
  const failed: string[] = [];
  let finalBody = fields.body;
  for (const attachment of attachments) {
    const body = new FormData(); body.append('file', attachment);
    try { const uploaded = await api<IssueAttachment>(`/issues/${issue.id}/attachments`, { method: 'POST', body }); finalBody = replacePendingImage(finalBody, attachment, uploaded.url); } catch { failed.push(attachment.name); finalBody = removePendingImage(finalBody, attachment); }
  }
  if (finalBody !== issue.body) {
    try { issue = await api<Issue>(`/issues/${issue.id}`, { method: 'PATCH', ...jsonBody({ body: finalBody, updatedAt: issue.updatedAt }) }); }
    catch { failed.push('Markdown 图片引用'); }
  }
  return { issue, failed };
}

export function NewIssuePage() {
  const meta = useIssueMetadata(); const navigate = useNavigate(); const client = useQueryClient();
  const mutation = useMutation({ mutationFn: createIssueWithAttachments, onSuccess: ({ issue, failed }) => { void client.invalidateQueries({ queryKey: ['issues'] }); navigate(`/issues/${issue.id}`, { state: failed.length ? { attachmentWarning: `Issue 已创建，但以下内容处理失败：${failed.join('、')}` } : undefined }); } });
  return <div className="page-container"><PageHeader title="新建 Issue" description="描述问题，并选择合适的负责人和分类" />{meta.loading ? <Spinner label="正在准备表单" /> : <IssueForm users={meta.users} labels={meta.labels} milestones={meta.milestones} loading={mutation.isPending} error={mutation.error?.message} onSubmit={(values) => mutation.mutate(values)} />}</div>;
}
