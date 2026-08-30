import type { BusinessRole, Issue, Label, PageResult, User } from './types';
type RawAssignee = User | { user: User; ownerType?: 'PRODUCT' | 'DEVELOPMENT' };
type RawIssue = Omit<Issue, 'number' | 'status' | 'assignees' | 'productOwners' | 'developerOwners' | 'labels' | 'commentsCount'> & { number?: number; state?: Issue['status']; status?: Issue['status']; assignees?: RawAssignee[]; labels?: Array<Label | { label: Label }>; _count?: { comments?: number }; commentsCount?: number };
const normalizeUser = (user: User & { businessRoles?: Array<{ role: BusinessRole }> }): User => ({ ...user, roles: user.roles ?? user.businessRoles?.map(({ role }) => role) ?? [] });
export function normalizeIssue(raw: RawIssue): Issue {
  const assigned = (raw.assignees ?? []).map((item) => 'user' in item ? { user: normalizeUser(item.user), ownerType: item.ownerType ?? 'DEVELOPMENT' } : { user: normalizeUser(item), ownerType: 'DEVELOPMENT' as const });
  return { ...raw, author: normalizeUser(raw.author), number: raw.number ?? raw.id, status: raw.state ?? raw.status ?? 'OPEN', state: raw.state ?? raw.status, assignees: [...new Map(assigned.map(({ user }) => [user.id, user])).values()], productOwners: assigned.filter(({ ownerType }) => ownerType === 'PRODUCT').map(({ user }) => user), developerOwners: assigned.filter(({ ownerType }) => ownerType === 'DEVELOPMENT').map(({ user }) => user), labels: (raw.labels ?? []).map((item) => 'label' in item ? item.label : item), commentsCount: raw.commentsCount ?? raw._count?.comments ?? 0 };
}
export function normalizeIssuePage(raw: PageResult<RawIssue>): PageResult<Issue> { return { ...raw, items: raw.items.map(normalizeIssue) }; }
