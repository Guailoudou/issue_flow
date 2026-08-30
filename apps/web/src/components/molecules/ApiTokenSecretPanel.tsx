import { Check, Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../atoms/Button';

export function ApiTokenSecretPanel({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(token);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };
  return <section className="rounded-xl border border-amber-300 bg-amber-50 p-4" aria-labelledby="new-api-token-title">
    <div className="flex items-start gap-3"><KeyRound className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" /><div className="min-w-0 flex-1"><h2 id="new-api-token-title" className="font-semibold text-amber-950">请立即保存 API Token</h2><p className="mt-1 text-sm text-amber-900">该 Token 只显示一次，关闭后无法再次查看。</p></div></div>
    <code className="mt-3 block min-w-0 rounded-lg border border-amber-200 bg-white p-3 font-mono text-sm text-slate-900 [overflow-wrap:anywhere]" aria-label="新 API Token">{token}</code>
    <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" icon={copyState === 'copied' ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />} onClick={() => void copy()}>{copyState === 'copied' ? '已复制' : '复制 Token'}</Button><Button type="button" variant="ghost" onClick={onDismiss}>我已保存，关闭</Button>{copyState === 'error' && <span role="alert" className="text-sm text-red-700">自动复制失败，请手动复制上方 Token。</span>}</div>
  </section>;
}
