import { ClipboardPaste, File, FilePlus2, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert } from '../atoms/Alert';
import { Button } from '../atoms/Button';

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 20;
const PREVIEWABLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const isPreviewableAttachment = (mimeType: string) => PREVIEWABLE_IMAGE_TYPES.has(mimeType.toLowerCase());

export function validateAttachments(files: File[], existingCount = 0) {
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_SIZE) errors.push(`${file.name}：超过 10 MiB 限制`);
    else if (existingCount + accepted.length >= MAX_ATTACHMENT_COUNT) errors.push(`每个 Issue 最多可上传 ${MAX_ATTACHMENT_COUNT} 个附件`);
    else accepted.push(file);
  }
  return { accepted, errors };
}

export function AttachmentPicker({ value, onChange, disabled, existingCount = 0 }: { value: File[]; onChange: (files: File[]) => void; disabled?: boolean; existingCount?: number }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [draggingFiles, setDraggingFiles] = useState(false);
  const items = useMemo(() => value.map((file) => ({ file, previewUrl: isPreviewableAttachment(file.type) ? URL.createObjectURL(file) : null })), [value]);
  useEffect(() => () => items.forEach(({ previewUrl }) => { if (previewUrl) URL.revokeObjectURL(previewUrl); }), [items]);
  const append = (selected: File[], source: 'picker' | 'clipboard' | 'drop') => {
    const result = validateAttachments(selected, existingCount + value.length);
    setErrors(result.errors);
    if (result.accepted.length) onChange([...value, ...result.accepted]);
    setFeedback(result.accepted.length && source !== 'picker' ? `已通过${source === 'clipboard' ? '粘贴' : '拖拽'}添加 ${result.accepted.length} 个附件` : '');
    if (inputRef.current) inputRef.current.value = '';
  };
  const paste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    append(files, 'clipboard');
  };
  const containsFiles = (dataTransfer: DataTransfer) => Array.from(dataTransfer.types ?? []).includes('Files') || dataTransfer.files.length > 0;
  const dragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    if (!disabled) setDraggingFiles(true);
  };
  const dragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  };
  const dragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingFiles(false);
  };
  const drop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingFiles(false);
    if (!disabled) append(Array.from(event.dataTransfer.files), 'drop');
  };
  return <div className="space-y-3">
    <input ref={inputRef} id={inputId} className="sr-only" type="file" multiple disabled={disabled} onChange={(event) => append(Array.from(event.target.files ?? []), 'picker')} />
    <div role="group" aria-label="附件粘贴与拖拽区域" tabIndex={disabled ? undefined : 0} onPaste={paste} onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop} className={`rounded-lg border border-dashed p-3 outline-none transition-colors focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/25 ${draggingFiles ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-slate-50'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={disabled || existingCount + value.length >= MAX_ATTACHMENT_COUNT} icon={<FilePlus2 className="size-4" aria-hidden="true" />} onClick={() => inputRef.current?.click()}>选择文件</Button>
        <span className="flex items-center gap-1.5 text-sm text-slate-600"><ClipboardPaste className="size-4 shrink-0" aria-hidden="true" />拖拽文件到此处，或聚焦后按 Ctrl+V / ⌘V 粘贴</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">不限文件类型；单个不超过 10 MiB，最多 20 个</p>
    </div>
    {feedback && <p role="status" className="text-sm font-medium text-emerald-700">{feedback}</p>}
    {errors.length > 0 && <Alert message={errors.join('；')} />}
    {items.length > 0 && <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label="待上传附件">
      {items.map(({ file, previewUrl }, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className="min-w-0 overflow-hidden rounded-lg border bg-slate-50">
        <div className="flex aspect-square items-center justify-center overflow-hidden bg-slate-100">{previewUrl ? <img src={previewUrl} alt={file.name} className="size-full object-cover" /> : <File className="size-10 text-slate-400" aria-hidden="true" />}</div>
        <div className="flex items-center gap-1 p-2"><span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={file.name}>{file.name}</span><button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700" aria-label={`移除 ${file.name}`} disabled={disabled} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" aria-hidden="true" /></button></div>
      </li>)}
    </ul>}
  </div>;
}
