import type { PrismaClient, User } from "@prisma/client";
import { ApiError } from "./errors";

export const publicUser = ({ passwordHash: _, ...user }: User) => user;
export const parseId = (value: unknown) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Invalid numeric identifier");
  return id;
};

export async function issueAccess(prisma: PrismaClient, issueId: number, user: User, mode: "edit" | "manage") {
  const issue = await prisma.issue.findUnique({ where: { id: issueId }, include: { assignees: true } });
  if (!issue) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
  const assigned = issue.assignees.some((item) => item.userId === user.id);
  const allowed = user.role === "ADMIN" || issue.authorId === user.id || (mode === "manage" && assigned);
  if (!allowed) throw new ApiError(403, "FORBIDDEN", "You do not have permission to modify this issue");
  return issue;
}

export const timelineData = (data: unknown) => JSON.stringify(data);

export async function notifyIssue(prisma: PrismaClient, issueId: number, actorId: number, type: string, message: string, extraUserIds: number[] = []) {
  const subscriptions = await prisma.subscription.findMany({ where: { issueId }, select: { userId: true } });
  const userIds = [...new Set([...subscriptions.map((item) => item.userId), ...extraUserIds])].filter((id) => id !== actorId);
  if (userIds.length) await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, issueId, type, message })) });
}

export async function mentionIds(prisma: PrismaClient, body: string) {
  const names = [...new Set([...body.matchAll(/(^|\s)@([a-zA-Z0-9_-]+)/g)].map((match) => match[2]).filter((name): name is string => Boolean(name)))];
  if (!names.length) return [];
  return (await prisma.user.findMany({ where: { username: { in: names }, active: true }, select: { id: true } })).map((user) => user.id);
}
