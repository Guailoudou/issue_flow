import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Filters } from './FilterBar';
import { IssueExportDialog } from './IssueExportDialog';
import { downloadApiFile } from '../../lib/download';

vi.mock('../../lib/download', () => ({ downloadApiFile: vi.fn(async () => '需求进度管理.xlsx') }));
const filters: Filters = { q: '登录', status: 'CLOSED', assignee: '2', author: '3', label: '4', milestone: '5', sort: 'created-asc' };

describe('IssueExportDialog', () => {
  beforeEach(() => vi.mocked(downloadApiFile).mockClear());
  it('说明导出规则并按所选关闭时间范围导出', async () => {
    const onExported = vi.fn(); render(<IssueExportDialog open filters={filters} onClose={vi.fn()} onExported={onExported} />);
    expect(screen.getByText(/所有未关闭 Issue 都会导出/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/关闭时间开始日期/), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText(/关闭时间结束日期/), { target: { value: '2026-08-31' } });
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }));
    await waitFor(() => expect(downloadApiFile).toHaveBeenCalledTimes(1));
    const path = vi.mocked(downloadApiFile).mock.calls[0][0]; const params = new URLSearchParams(path.split('?')[1]);
    expect(params.has('state')).toBe(false);
    expect(params.get('closedFrom')).toBe(new Date('2026-08-01T00:00:00.000').toISOString());
    expect(params.get('closedTo')).toBe(new Date('2026-08-31T23:59:59.999').toISOString());
    expect(onExported).toHaveBeenCalledWith('需求进度管理.xlsx');
  });
});
