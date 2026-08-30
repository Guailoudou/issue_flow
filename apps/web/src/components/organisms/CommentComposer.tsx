import { useEffect, useRef, useState } from 'react';
import { Alert } from '../atoms/Alert';
import { Button } from '../atoms/Button';
import { MarkdownEditor } from '../molecules/MarkdownEditor';
import type { Comment } from '../../lib/types';

export function CommentComposer({ onSubmit, onPasteImage, quote, loading, error }: { onSubmit: (body: string) => void; onPasteImage?: (file: File) => Promise<string>; quote?: Comment | null; loading?: boolean; error?: string }) {
  const [body, setBody] = useState('');
  const wasLoading = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!quote) return;
    const quoted = quote.body.split('\n').map((line) => `> ${line}`).join('\n');
    setBody((current) => `${current}${current.trim() ? '\n\n' : ''}${quoted}\n\n@${quote.author.username} `);
    requestAnimationFrame(() => { form.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); form.current?.querySelector('textarea')?.focus(); });
  }, [quote]);

  useEffect(() => {
    if (wasLoading.current && !loading && !error) setBody('');
    wasLoading.current = !!loading;
  }, [loading, error]);

  return <form ref={form} onSubmit={(e) => { e.preventDefault(); if (body.trim()) onSubmit(body.trim()); }} className="surface space-y-3 p-4"><h2 className="font-semibold">发表评论</h2>{error && <Alert message={error} />}<MarkdownEditor id="comment-body" value={body} onChange={setBody} onPasteImage={onPasteImage} placeholder="留下你的评论…" minRows={5} /><div className="flex justify-end"><Button type="submit" disabled={!body.trim()} loading={loading}>发表评论</Button></div></form>;
}
