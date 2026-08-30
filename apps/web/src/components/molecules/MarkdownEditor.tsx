import { Eye, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Textarea } from '../atoms/Textarea';
import { MarkdownRenderer } from './MarkdownRenderer';
export function MarkdownEditor({ id, value, onChange, error, placeholder = '使用 Markdown 描述内容…', minRows = 8 }: { id: string; value: string; onChange: (value: string) => void; error?: string; placeholder?: string; minRows?: number }) {
  const [preview, setPreview] = useState(false);
  return <div className={`overflow-hidden rounded-lg border bg-white ${error ? 'border-red-500' : 'border-slate-300'}`}>
    <div className="flex border-b bg-slate-50 p-1" role="tablist" aria-label="Markdown 编辑器模式">
      <button type="button" role="tab" aria-selected={!preview} onClick={() => setPreview(false)} className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium ${!preview ? 'bg-white text-slate-900' : 'text-slate-600 hover:bg-white/60'}`}><Pencil className="size-4" />编辑</button>
      <button type="button" role="tab" aria-selected={preview} onClick={() => setPreview(true)} className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium ${preview ? 'bg-white text-slate-900' : 'text-slate-600 hover:bg-white/60'}`}><Eye className="size-4" />预览</button>
    </div>
    {preview ? <div role="tabpanel" className="min-h-44 p-4"><MarkdownRenderer value={value} emptyText="输入 Markdown 后可在此预览" /></div> : <Textarea id={id} value={value} rows={minRows} placeholder={placeholder} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} className="min-h-44 rounded-none border-0 focus:ring-0" />}
  </div>;
}
