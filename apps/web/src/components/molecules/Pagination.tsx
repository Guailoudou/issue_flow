import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../atoms/Button';
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <nav aria-label="分页" className="flex items-center justify-between gap-3 border-t px-4 py-3">
    <Button variant="ghost" onClick={() => onChange(page - 1)} disabled={page <= 1} icon={<ChevronLeft className="size-4" />}>上一页</Button>
    <span className="text-sm text-slate-600"><span className="sr-only">当前</span>第 {page} / {totalPages} 页</span>
    <Button variant="ghost" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>下一页<ChevronRight className="size-4" /></Button>
  </nav>;
}
