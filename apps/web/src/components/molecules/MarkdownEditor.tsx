import { Bold, Code2, Eye, Heading2, Italic, Link2, List, ListOrdered, Pencil, Quote } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert } from '../atoms/Alert';
import { Textarea } from '../atoms/Textarea';
import { MarkdownRenderer } from './MarkdownRenderer';
type EditorProps = { id: string; value: string; onChange: (value: string) => void; error?: string; placeholder?: string; minRows?: number; onPasteImage?: (file: File) => Promise<string> };
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function MarkdownEditor({ id, value, onChange, error, placeholder = '使用 Markdown 描述内容…', minRows = 8, onPasteImage }: EditorProps) {
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const latestValue = useRef(value); latestValue.current = value;
  const update = (next: string) => { latestValue.current = next; onChange(next); };
  const replaceSelection = (before: string, after = before, fallback = '文本', linePrefix = false) => {
    const element = textarea.current; if (!element) return;
    const start = element.selectionStart; const end = element.selectionEnd; const selected = value.slice(start, end) || fallback;
    const formatted = linePrefix ? selected.split('\n').map((line) => `${before}${line}`).join('\n') : `${before}${selected}${after}`;
    update(`${value.slice(0, start)}${formatted}${value.slice(end)}`);
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + before.length, start + formatted.length - after.length); });
  };
  const paste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.files).filter((file) => imageTypes.has(file.type.toLowerCase()));
    if (!images.length || !onPasteImage) return;
    event.preventDefault(); setUploadError('');
    const element = event.currentTarget; const start = element.selectionStart; const end = element.selectionEnd;
    const tokens = images.map((file) => ({ file, token: `![正在上传 ${file.name || '图片'}](issueflow-uploading:${crypto.randomUUID()})` }));
    update(`${value.slice(0, start)}${tokens.map(({ token }) => token).join('\n')}${value.slice(end)}`); setUploading((count) => count + images.length);
    await Promise.all(tokens.map(async ({ file, token }) => {
      try {
        const url = await onPasteImage(file); const name = (file.name || '图片').replaceAll(']', '\\]');
        update(latestValue.current.replace(token, `![${name}](${url})`));
      } catch (reason) {
        update(latestValue.current.replace(token, '')); setUploadError(reason instanceof Error ? reason.message : '图片上传失败');
      } finally { setUploading((count) => count - 1); }
    }));
  };
  const tools = [
    ['二级标题', Heading2, () => replaceSelection('## ', '', '标题', true)], ['粗体', Bold, () => replaceSelection('**')], ['斜体', Italic, () => replaceSelection('*')],
    ['链接', Link2, () => replaceSelection('[', '](https://)', '链接文字')], ['行内代码', Code2, () => replaceSelection('`')], ['引用', Quote, () => replaceSelection('> ', '', '引用', true)],
    ['无序列表', List, () => replaceSelection('- ', '', '列表项', true)], ['有序列表', ListOrdered, () => replaceSelection('1. ', '', '列表项', true)],
  ] as const;
  return <div className={`overflow-hidden rounded-lg border bg-white ${error ? 'border-red-500' : 'border-slate-300'}`}>
    <div className="flex flex-wrap items-center border-b bg-slate-50 p-1">
      <div className="flex" role="tablist" aria-label="Markdown 编辑器模式"><button type="button" role="tab" aria-selected={!preview} onClick={() => setPreview(false)} className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium ${!preview ? 'bg-white text-slate-900' : 'text-slate-600 hover:bg-white/60'}`}><Pencil className="size-4" aria-hidden="true" />编辑</button><button type="button" role="tab" aria-selected={preview} onClick={() => setPreview(true)} className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium ${preview ? 'bg-white text-slate-900' : 'text-slate-600 hover:bg-white/60'}`}><Eye className="size-4" aria-hidden="true" />预览</button></div>
      {!preview && <div className="ml-auto flex flex-wrap" role="toolbar" aria-label="Markdown 格式工具">{tools.map(([label, Icon, action]) => <button key={label} type="button" className="flex size-11 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/25" aria-label={label} title={label} onClick={action}><Icon className="size-4" aria-hidden="true" /></button>)}</div>}
    </div>
    {preview ? <div role="tabpanel" className="min-h-44 p-4"><MarkdownRenderer value={value} emptyText="输入 Markdown 后可在此预览" /></div> : <Textarea ref={textarea} id={id} value={value} rows={minRows} placeholder={placeholder} aria-invalid={!!error || !!uploadError} aria-describedby={error ? `${id}-error` : uploadError ? `${id}-upload-error` : undefined} onPaste={(event) => void paste(event)} onChange={(event) => update(event.target.value)} className="min-h-44 rounded-none border-0 focus:ring-0" />}
    {(uploading > 0 || uploadError) && <div className="border-t px-3 py-2">{uploading > 0 && <p role="status" className="text-sm text-slate-600">正在上传 {uploading} 张图片…</p>}{uploadError && <div id={`${id}-upload-error`}><Alert message={uploadError} /></div>}</div>}
  </div>;
}
