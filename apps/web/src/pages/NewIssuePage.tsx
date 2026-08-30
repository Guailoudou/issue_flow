import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/atoms/Spinner';
import { PageHeader } from '../components/molecules/PageHeader';
import { IssueForm, type IssueFormValues } from '../components/organisms/IssueForm';
import { useIssueMetadata } from '../features/issues/useIssueMetadata';
import { api, jsonBody } from '../lib/api';
import type { Issue } from '../lib/types';

async function createIssueWithAttachments(values: IssueFormValues) {
  const { attachments, ...fields } = values;
  const issue = await api<Issue>('/issues', { method: 'POST', ...jsonBody({ ...fields, milestoneId: fields.milestoneId || null }) });
  const failed: string[] = [];
  for (const attachment of attachments) {
    const body = new FormData(); body.append('file', attachment);
    try { await api(`/issues/${issue.id}/attachments`, { method: 'POST', body }); } catch { failed.push(attachment.name); }
  }
  return { issue, failed, total: attachments.length };
}

export function NewIssuePage() {
  const meta = useIssueMetadata(); const navigate = useNavigate(); const client = useQueryClient();
  const mutation = useMutation({ mutationFn: createIssueWithAttachments, onSuccess: ({ issue, failed, total }) => { void client.invalidateQueries({ queryKey: ['issues'] }); navigate(`/issues/${issue.id}`, { state: failed.length ? { attachmentWarning: `Issue 已创建，但 ${failed.length}/${total} 个附件上传失败：${failed.join('、')}` } : undefined }); } });
  return <div className="page-container"><PageHeader title="新建 Issue" description="描述问题，并选择合适的负责人和分类" />{meta.loading ? <Spinner label="正在准备表单" /> : <IssueForm users={meta.users} labels={meta.labels} milestones={meta.milestones} loading={mutation.isPending} error={mutation.error?.message} onSubmit={(values) => mutation.mutate(values)} />}</div>;
}
