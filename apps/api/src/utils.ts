import type { Notification, Prisma, PrismaClient, User, UserRole } from "@prisma/client";
import { ApiError } from "./errors";
import type { RealtimeHub } from "./realtime/hub";

type UserWithRoles = User & { businessRoles?: UserRole[] };
export const publicUser = ({ passwordHash: _, businessRoles = [], ...user }: UserWithRoles) => ({ ...user, roles: businessRoles.map(({ role }) => role) });
export const hasRole = (user: UserWithRoles, role: string) => user.businessRoles?.some((item) => item.role === role) ?? false;
export const isAdmin = (user: UserWithRoles) => user.role === "ADMIN" || hasRole(user, "MANAGEMENT");
export const parseId = (value: unknown) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Invalid numeric identifier");
  return id;
};

export async function issueAccess(prisma: PrismaClient, issueId: number, user: UserWithRoles, mode: "edit" | "manage") {
  const issue = await prisma.issue.findUnique({ where: { id: issueId }, include: { assignees: true } });
  if (!issue) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
  const assigned = issue.assignees.some((item) => item.userId === user.id);
  const allowed = isAdmin(user) || issue.authorId === user.id || (mode === "manage" && assigned);
  if (!allowed) throw new ApiError(403, "FORBIDDEN", "You do not have permission to modify this issue");
  return issue;
}

export const timelineData = (data: unknown) => JSON.stringify(data);

export async function notifyIssue(
  prisma: Pick<Prisma.TransactionClient, "subscription" | "notification">,
  issueId: number,
  actorId: number,
  type: string,
  message: string,
  extraUserIds: number[] = [],
  extraType = type,
  extraMessage = message,
) {
  const subscriptions = await prisma.subscription.findMany({ where: { issueId }, select: { userId: true } });
  const recipients = new Map<number, { type: string; message: string }>();
  for (const { userId } of subscriptions) if (userId !== actorId) recipients.set(userId, { type, message });
  for (const userId of extraUserIds) if (userId !== actorId) recipients.set(userId, { type: extraType, message: extraMessage });
  if (!recipients.size) return [];
  const notifications: Notification[] = [];
  for (const [userId, notification] of recipients) {
    notifications.push(await prisma.notification.create({ data: { userId, issueId, ...notification } }));
  }
  return notifications;
}

export function publishNotifications(realtime: RealtimeHub, notifications: Notification[]) {
  if (!notifications.length) return;
  for (const notification of notifications) realtime.publish([notification.userId], {
    type: "notification.created",
    notification: {
      id: notification.id,
      issueId: notification.issueId,
      type: notification.type,
      message: notification.message,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    },
  });
}

export async function issueRelatedUserIds(prisma: PrismaClient, issueId: number, additional: number[] = []) {
  const [subscriptions, assignees] = await Promise.all([
    prisma.subscription.findMany({ where: { issueId }, select: { userId: true } }),
    prisma.issueAssignee.findMany({ where: { issueId }, select: { userId: true } }),
  ]);
  return [...new Set([...subscriptions.map(({ userId }) => userId), ...assignees.map(({ userId }) => userId), ...additional])];
}

export async function mentionIds(prisma: PrismaClient, body: string) {
  const names = [...new Set([...body.matchAll(/(^|\s)@([a-zA-Z0-9_-]+)/g)].map((match) => match[2]).filter((name): name is string => Boolean(name)))];
  if (!names.length) return [];
  return (await prisma.user.findMany({ where: { username: { in: names }, active: true }, select: { id: true } })).map((user) => user.id);
}
