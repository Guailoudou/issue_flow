import { useForm, Controller } from 'react-hook-form';
import type { Label, Milestone, User } from '../../lib/types';
import { Alert } from '../atoms/Alert';
import { Button } from '../atoms/Button';
import { FormField } from '../atoms/FormField';
import { Input } from '../atoms/Input';
import { LabelPicker } from '../molecules/LabelPicker';
import { MarkdownEditor } from '../molecules/MarkdownEditor';
import { MilestonePicker } from '../molecules/MilestonePicker';
import { UserPicker } from '../molecules/UserPicker';
import { AttachmentPicker } from '../molecules/AttachmentPicker';

export interface IssueFormValues { title: string; body: string; productOwnerIds: number[]; developerOwnerIds: number[]; labelIds: number[]; milestoneId: number | ''; attachments: File[] }
export function IssueForm({ users, labels, milestones, initial, loading, error, submitLabel = '创建 Issue', onSubmit }: { users: User[]; labels: Label[]; milestones: Milestone[]; initial?: Partial<IssueFormValues>; loading?: boolean; error?: string; submitLabel?: string; onSubmit: (values: IssueFormValues) => void }) {
  const { register, handleSubmit, control, formState: { errors } } = useForm<IssueFormValues>({ defaultValues: { title: '', body: '', productOwnerIds: [], developerOwnerIds: [], labelIds: [], milestoneId: '', attachments: [], ...initial } });
  return <form onSubmit={handleSubmit(onSubmit)} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div className="surface space-y-5 p-4 sm:p-5">{error && <Alert message={error} />}<FormField label="标题" htmlFor="issue-title" required error={errors.title?.message}><Input id="issue-title" maxLength={200} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'issue-title-error' : undefined} {...register('title', { required: '请输入标题', validate: (value) => value.trim().length > 0 || '标题不能为空' })} /></FormField><FormField label="描述" htmlFor="issue-body" hint="支持 GitHub Flavored Markdown"><Controller name="body" control={control} render={({ field }) => <MarkdownEditor id="issue-body" value={field.value} onChange={field.onChange} />} /></FormField><section aria-labelledby="issue-attachments-label"><h2 id="issue-attachments-label" className="mb-2 text-sm font-semibold">附件</h2><Controller name="attachments" control={control} render={({ field }) => <AttachmentPicker value={field.value} onChange={field.onChange} disabled={loading} />} /></section><div className="flex justify-end"><Button type="submit" loading={loading}>{submitLabel}</Button></div></div>
    <aside className="surface divide-y"><section className="p-4"><h2 className="mb-2 text-sm font-semibold">产品负责人</h2><Controller name="productOwnerIds" control={control} render={({ field }) => <UserPicker users={users.filter((user) => user.roles?.includes('PRODUCT'))} value={field.value} onChange={field.onChange} ariaLabel="选择产品负责人" />} /></section><section className="p-4"><h2 className="mb-2 text-sm font-semibold">开发负责人</h2><Controller name="developerOwnerIds" control={control} render={({ field }) => <UserPicker users={users.filter((user) => user.roles?.includes('DEVELOPMENT'))} value={field.value} onChange={field.onChange} ariaLabel="选择开发负责人" />} /></section><section className="p-4"><h2 className="mb-2 text-sm font-semibold">标签</h2><Controller name="labelIds" control={control} render={({ field }) => <LabelPicker labels={labels} value={field.value} onChange={field.onChange} />} /></section><section className="p-4"><h2 className="mb-2 text-sm font-semibold">里程碑</h2><Controller name="milestoneId" control={control} render={({ field }) => <MilestonePicker milestones={milestones} value={field.value} onChange={field.onChange} />} /></section></aside>
  </form>;
}
