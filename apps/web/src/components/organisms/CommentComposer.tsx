import { useState } from 'react';
import { Alert } from '../atoms/Alert';
import { Button } from '../atoms/Button';
import { MarkdownEditor } from '../molecules/MarkdownEditor';
export function CommentComposer({ onSubmit, onPasteImage, loading, error }: { onSubmit: (body: string) => void; onPasteImage?: (file: File) => Promise<string>; loading?: boolean; error?: string }) { const [body, setBody] = useState(''); return <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) onSubmit(body.trim()); }} className="surface space-y-3 p-4"><h2 className="font-semibold">发表评论</h2>{error && <Alert message={error} />}<MarkdownEditor id="comment-body" value={body} onChange={setBody} onPasteImage={onPasteImage} placeholder="留下你的评论…" minRows={5} /><div className="flex justify-end"><Button type="submit" disabled={!body.trim()} loading={loading}>发表评论</Button></div></form>; }
