export type Role = 'ADMIN' | 'USER';
export type BusinessRole = 'MANAGEMENT' | 'DEVELOPMENT' | 'PRODUCT';
export type IssueStatus = 'OPEN' | 'AWAITING_ACCEPTANCE' | 'CLOSED';
export type MilestoneStatus = 'OPEN' | 'CLOSED';

export type EntityId = number;
export interface User { id: EntityId; username: string; displayName: string; email?: string; role: Role; roles?: BusinessRole[]; active: boolean; avatarUrl?: string; createdAt?: string; updatedAt?: string }
export interface Label { id: EntityId; name: string; description?: string; color: string }
export interface Milestone { id: EntityId; title: string; description?: string; dueDate?: string | null; status?: MilestoneStatus; state?: MilestoneStatus; openIssues?: number; closedIssues?: number }
export interface Comment { id: EntityId; body: string; author: User; createdAt: string; updatedAt?: string; deletedAt?: string | null }
export interface TimelineEvent { id: EntityId; type: string; actor: User; createdAt: string; metadata?: Record<string, unknown>; data?: Record<string, unknown>; comment?: Comment }
export interface Issue {
  id: EntityId; number: number; title: string; body?: string; status: IssueStatus; state?: IssueStatus; author: User;
  assignees: User[]; productOwners: User[]; developerOwners: User[]; labels: Label[]; milestone?: Milestone | null; commentsCount?: number; isProductIssue?: boolean;
  createdAt: string; updatedAt: string; subscribed?: boolean;
}
export interface Notification { id: EntityId; type: string; title?: string; message: string; readAt?: string | null; createdAt: string; issue?: Pick<Issue, 'id' | 'number' | 'title'> }
export interface PlatformSettings { platformName: string; name?: string; description?: string; logoUrl?: string; logoText?: string; defaultPageSize: number; allowUserCreateIssue: boolean }
export interface PageResult<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; page?: number; pageSize?: number; total?: number; totalPages?: number; unread?: number }
export interface DashboardStats { totalUsers: number; activeUsers: number; openIssues: number; closedIssues: number; issuesLast7Days: number; commentsLast7Days: number; recentActivity: TimelineEvent[] }

export type YunxiaoEdition = 'CENTRAL' | 'REGION';
export interface YunxiaoIntegration {
  enabled: boolean;
  edition: YunxiaoEdition;
  baseUrl: string;
  organizationId?: string | null;
  repositoryId: string;
  repositoryName?: string | null;
  repositoryWebUrl?: string | null;
  hasToken: boolean;
  hasWebhookSecret: boolean;
  lastTestedAt?: string | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
  updatedAt?: string | null;
}
export interface YunxiaoIntegrationResponse {
  integration: YunxiaoIntegration;
  webhook: { url: string; events: string[] };
}
export interface CodeReference {
  id: EntityId;
  type: 'COMMIT' | 'MERGE_REQUEST';
  externalId: string;
  title: string;
  url?: string | null;
  status?: string | null;
  sourceBranch?: string | null;
  targetBranch?: string | null;
  authorName?: string | null;
  commitSha?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueAttachment {
  id: EntityId;
  issueId: EntityId;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
  uploader: User;
  canDelete: boolean;
}

export interface ApiToken {
  id: EntityId;
  name: string;
  prefix: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
}
