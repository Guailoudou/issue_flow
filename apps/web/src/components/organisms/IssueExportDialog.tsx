import { FileDown } from 'lucide-react';
import { useState } from 'react';
import type { Filters } from './FilterBar';
import { Button } from '../atoms/Button';
import { FormField } from '../atoms/FormField';
import { Input } from '../atoms/Input';
import { Modal } from '../atoms/Modal';
import { downloadApiFile } from '../../lib/download';
import { currentMonthRange, issueExportPath, type IssueExportRange } from '../../lib/issueExport';

function validateRange(range: IssueExportRange) {
  if (!range.from) return { from: '请选择开始日期' };
  if (!range.to) return { to: '请选择结束日期' };
  if (range.from > range.to) return { to: '结束日期不能早于开始日期' };
  return {};
}

export function IssueExportDialog({ open, filters, onClose, onExported }: { open: boolean; filters: Filters; onClose: () => void; onExported: (fileName: string) => void }) {
  const [range, setRange] = useState<IssueExportRange>(() => currentMonthRange());
  const [errors, setErrors] = useState<{ from?: string; to?: string }>({});
  const [exporting, setExporting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const updateRange = (key: keyof IssueExportRange, value: string) => { const next = { ...range, [key]: value }; setRange(next); setErrors(validateRange(next)); setRequestError(''); };
  const submit = async () => {
    const nextErrors = validateRange(range); setErrors(nextErrors); setRequestError('');
    if (Object.keys(nextErrors).length) return;
    setExporting(true);
    try { const fileName = await downloadApiFile(issueExportPath(filters, range)); onExported(fileName); onClose(); }
    catch (error) { setRequestError(error instanceof Error ? error.message : '导出失败，请稍后重试'); }
    finally { setExporting(false); }
  };
  return <Modal open={open} title="选择导出时间段" onClose={onClose}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900"><strong>导出规则：</strong>所有未关闭 Issue 都会导出；所选时间段仅用于筛选已关闭 Issue 的关闭时间。</div>
    <div className="grid gap-4 sm:grid-cols-2"><FormField label="关闭时间开始日期" htmlFor="export-closed-from" error={errors.from} required><Input id="export-closed-from" type="date" value={range.from} max={range.to || undefined} aria-describedby={errors.from ? 'export-closed-from-error' : undefined} onChange={(event) => updateRange('from', event.target.value)} onBlur={() => setErrors(validateRange(range))} /></FormField><FormField label="关闭时间结束日期" htmlFor="export-closed-to" error={errors.to} required><Input id="export-closed-to" type="date" value={range.to} min={range.from || undefined} aria-describedby={errors.to ? 'export-closed-to-error' : undefined} onChange={(event) => updateRange('to', event.target.value)} onBlur={() => setErrors(validateRange(range))} /></FormField></div>
    {requestError && <p role="alert" className="text-sm text-red-700">{requestError}</p>}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" disabled={exporting} onClick={onClose}>取消</Button><Button type="submit" loading={exporting} icon={<FileDown className="size-4" aria-hidden="true" />}>开始导出</Button></div>
  </form></Modal>;
}
