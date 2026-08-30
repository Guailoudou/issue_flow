import { describe, expect, it } from 'vitest';
import type { Filters } from '../components/organisms/FilterBar';
import { issueExportPath } from '../lib/issueExport';
import { issueListStateQuery } from './IssueListPage';

describe('Issue 导出筛选', () => {
  it('保留非状态筛选并携带关闭时间范围', () => {
    const filters: Filters = { q: '登录', status: 'CLOSED', assignee: '2', author: '3', label: '4', milestone: '5', sort: 'created-asc' };
    const path = issueExportPath(filters, { from: '2026-08-01', to: '2026-08-31' }); const params = new URLSearchParams(path.split('?')[1]);
    expect(path.startsWith('/issues/export.xlsx?')).toBe(true);
    expect(Object.fromEntries(params)).toEqual({ q: '登录', authorId: '3', assigneeId: '2', labelId: '4', milestoneId: '5', sort: 'createdAt', order: 'asc', closedFrom: new Date('2026-08-01T00:00:00.000').toISOString(), closedTo: new Date('2026-08-31T23:59:59.999').toISOString() });
    expect(params.has('state')).toBe(false);
    expect(params.has('page')).toBe(false); expect(params.has('pageSize')).toBe(false);
  });
});

describe('Issue 首页状态筛选', () => {
  it('全部状态不向 API 发送 state，开放状态保留 OPEN 分类参数', () => {
    expect(issueListStateQuery('ALL')).toBeUndefined();
    expect(issueListStateQuery('OPEN')).toBe('OPEN');
    expect(issueListStateQuery('CLOSED')).toBe('CLOSED');
  });
});
