import type { Filters } from '../components/organisms/FilterBar';
import { queryString } from './api';

export interface IssueExportRange { from: string; to: string }

function localDayBoundary(value: string, endOfDay: boolean) {
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

export function issueExportPath(filters: Filters, range: IssueExportRange) {
  const [sort, order] = filters.sort.split('-') as ['created' | 'updated', 'asc' | 'desc'];
  return `/issues/export.xlsx${queryString({
    q: filters.q,
    authorId: filters.author,
    assigneeId: filters.assignee,
    labelIds: filters.label,
    milestoneId: filters.milestone,
    sort: sort === 'created' ? 'createdAt' : 'updatedAt',
    order,
    closedFrom: localDayBoundary(range.from, false),
    closedTo: localDayBoundary(range.to, true),
  })}`;
}

export function currentMonthRange(now = new Date()): IssueExportRange {
  const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, '0'); const day = String(now.getDate()).padStart(2, '0');
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${day}` };
}
