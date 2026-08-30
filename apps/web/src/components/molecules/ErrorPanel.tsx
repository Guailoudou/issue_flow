import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../atoms/Button';
export function ErrorPanel({ title = '加载失败', message = '无法获取数据，请稍后重试。', onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return <div role="alert" className="flex min-h-56 flex-col items-center justify-center px-6 text-center"><AlertTriangle className="mb-3 size-8 text-red-600" aria-hidden="true" /><h2 className="font-semibold">{title}</h2><p className="mt-1 max-w-md text-sm text-slate-600">{message}</p>{onRetry && <Button className="mt-4" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={onRetry}>重试</Button>}</div>;
}
