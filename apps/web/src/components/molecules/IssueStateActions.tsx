import { CircleCheck, ClipboardCheck, RotateCcw } from 'lucide-react';
import type { IssueStatus } from '../../lib/types';
import { Button } from '../atoms/Button';

export function IssueStateActions({ status, loading, onChange }: { status: IssueStatus; loading?: boolean; onChange: (status: IssueStatus) => void }) {
  return <div className="flex flex-wrap gap-2" aria-label="Issue 状态操作">
    {status !== 'OPEN' && <Button type="button" variant="secondary" loading={loading} icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => onChange('OPEN')}>重新打开</Button>}
    {status !== 'AWAITING_ACCEPTANCE' && <Button type="button" variant="secondary" loading={loading} icon={<ClipboardCheck className="size-4" aria-hidden="true" />} onClick={() => onChange('AWAITING_ACCEPTANCE')}>标记待验收</Button>}
    {status !== 'CLOSED' && <Button type="button" variant="danger" loading={loading} icon={<CircleCheck className="size-4" aria-hidden="true" />} onClick={() => onChange('CLOSED')}>关闭 Issue</Button>}
  </div>;
}
