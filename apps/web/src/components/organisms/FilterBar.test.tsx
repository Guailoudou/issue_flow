import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FilterBar, type Filters } from './FilterBar';
const value: Filters = { q: '', status: 'OPEN', assignee: '', author: '', label: '', milestone: '', sort: 'updated-desc' };
describe('FilterBar', () => { it('将待验收归入开放，并使用明确的 ALL 值筛选全部状态', async () => { const user = userEvent.setup(); const onChange = vi.fn(); render(<FilterBar value={value} users={[]} labels={[]} milestones={[]} onChange={onChange} onClear={vi.fn()} />); expect(screen.getByRole('option', { name: '开放（含待验收）' })).toHaveValue('OPEN'); expect(screen.queryByRole('option', { name: '待验收' })).not.toBeInTheDocument(); await user.selectOptions(screen.getByRole('combobox', { name: '状态' }), 'ALL'); expect(onChange).toHaveBeenCalledWith({ status: 'ALL' }); await user.click(screen.getByRole('button', { name: '筛选' })); expect(screen.getByRole('combobox', { name: '作者' })).toBeVisible(); }); });
