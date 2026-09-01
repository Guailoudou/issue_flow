import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DESKTOP_RECENTLY_CLOSED_DAYS, updateDesktopPreferenceSchema } from "@issueflow/shared";
import { z } from "zod";
import { ApiError } from "../errors";
import { parseId } from "../utils";

const overviewQuerySchema = z.object({
  closedDays: z.coerce.number().int().refine((value) => DESKTOP_RECENTLY_CLOSED_DAYS.includes(value as (typeof DESKTOP_RECENTLY_CLOSED_DAYS)[number]), "Invalid recently closed day range").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

const userSelect = { id: true, username: true, displayName: true } as const;

function bodyExcerpt(body: string) {
  return body
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/[`*_>#~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function desktopRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/desktop/overview", { preHandler: app.authenticate }, async (request) => {
    const query = overviewQuerySchema.parse(request.query);
    const storedPreference = await prisma.desktopPreference.findUnique({ where: { userId: request.currentUser.id }, select: { recentlyClosedDays: true } });
    const closedDays = query.closedDays ?? storedPreference?.recentlyClosedDays ?? 7;
    const recentlyClosedSince = new Date(Date.now() - closedDays * 24 * 60 * 60 * 1000);
    const userId = request.currentUser.id;
    const include = {
      assignees: { include: { user: { select: userSelect } } },
      labels: { include: { label: true } },
      subscriptions: { where: { userId }, select: { userId: true } },
      notificationMutes: { where: { userId }, select: { createdAt: true } },
      notifications: { where: { userId }, orderBy: { createdAt: "desc" as const }, take: 1 },
      _count: { select: { notifications: { where: { userId, readAt: null } } } },
    } satisfies Prisma.IssueInclude;
    const assignedWhere: Prisma.IssueWhereInput = { state: "OPEN", assignees: { some: { userId } } };
    const followedWhere: Prisma.IssueWhereInput = { state: "OPEN", subscriptions: { some: { userId } }, NOT: { assignees: { some: { userId } } } };
    const recentlyClosedWhere: Prisma.IssueWhereInput = {
      state: "CLOSED",
      closedAt: { gte: recentlyClosedSince },
      OR: [{ assignees: { some: { userId } } }, { subscriptions: { some: { userId } } }],
    };
    const sectionIssueIds = async (where: Prisma.IssueWhereInput) => {
      const unreadRelation: Prisma.IssueWhereInput = { notifications: { some: { userId, readAt: null } } };
      const unread = await prisma.issue.findMany({
        where: { AND: [where, unreadRelation] },
        select: { id: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.limit,
      });
      const remaining = query.limit - unread.length;
      if (!remaining) return unread.map(({ id }) => id);
      const read = await prisma.issue.findMany({
        where: { AND: [where, { NOT: unreadRelation }] },
        select: { id: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: remaining,
      });
      return [...unread, ...read].map(({ id }) => id);
    };
    const [assignedIds, followedIds, recentlyClosedIds, assignedTotal, followedTotal, recentlyClosedTotal, unreadCount] = await Promise.all([
      sectionIssueIds(assignedWhere),
      sectionIssueIds(followedWhere),
      sectionIssueIds(recentlyClosedWhere),
      prisma.issue.count({ where: assignedWhere }),
      prisma.issue.count({ where: followedWhere }),
      prisma.issue.count({ where: recentlyClosedWhere }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    const selectedIds = [...new Set([...assignedIds, ...followedIds, ...recentlyClosedIds])];
    const allIssues = await prisma.issue.findMany({ where: { id: { in: selectedIds } }, include });
    const issueById = new Map(allIssues.map((issue) => [issue.id, issue]));
    const mentionedIssueIds = new Set((await prisma.notification.findMany({
      where: { userId, type: "MENTIONED", issueId: { in: allIssues.map(({ id }) => id) } },
      distinct: ["issueId"],
      select: { issueId: true },
    })).map(({ issueId }) => issueId).filter((id): id is number => id !== null));

    const serialize = (issue: (typeof allIssues)[number]) => {
      const assignees = [...new Map(issue.assignees.map(({ user }) => [user.id, user])).values()];
      const labels = issue.labels.map(({ label }) => label).sort((a, b) => a.name.localeCompare(b.name));
      const latestNotification = issue.notifications[0] ?? null;
      const relationReasons: Array<"ASSIGNED" | "MENTIONED" | "FOLLOWING"> = [];
      if (issue.assignees.some(({ userId: assignedUserId }) => assignedUserId === userId)) relationReasons.push("ASSIGNED");
      if (mentionedIssueIds.has(issue.id)) relationReasons.push("MENTIONED");
      if (issue.subscriptions.length) relationReasons.push("FOLLOWING");
      return {
        id: issue.id,
        title: issue.title,
        state: issue.state as "OPEN" | "CLOSED",
        bodyExcerpt: bodyExcerpt(issue.body),
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt,
        relationReasons,
        assignees,
        labels: labels.slice(0, 2).map(({ id, name, color }) => ({ id, name, color })),
        additionalLabelCount: Math.max(0, labels.length - 2),
        unreadCount: issue._count.notifications,
        subscribed: issue.subscriptions.length > 0,
        muted: issue.notificationMutes.length > 0,
        latestNotification: latestNotification ? {
          id: latestNotification.id,
          issueId: latestNotification.issueId,
          type: latestNotification.type,
          message: latestNotification.message,
          readAt: latestNotification.readAt,
          createdAt: latestNotification.createdAt,
        } : null,
      };
    };
    const serializeSection = (ids: number[]) => ids.map((id) => issueById.get(id)).filter((issue): issue is NonNullable<typeof issue> => Boolean(issue)).map(serialize);
    return {
      generatedAt: new Date(),
      unreadCount,
      sections: {
        assignedOpen: serializeSection(assignedIds),
        followedOpen: serializeSection(followedIds),
        recentlyClosed: serializeSection(recentlyClosedIds),
      },
      totals: { assignedOpen: assignedTotal, followedOpen: followedTotal, recentlyClosed: recentlyClosedTotal },
    };
  });

  app.get("/desktop/preferences", { preHandler: app.authenticate }, async (request) => {
    const preference = await prisma.desktopPreference.upsert({
      where: { userId: request.currentUser.id },
      update: {},
      create: { userId: request.currentUser.id },
    });
    const { userId: _, createdAt: __, ...result } = preference;
    return result;
  });

  app.patch("/desktop/preferences", { preHandler: app.authenticate }, async (request) => {
    const input = updateDesktopPreferenceSchema.parse(request.body);
    if (input.timeZone !== undefined && !validTimeZone(input.timeZone)) throw new ApiError(400, "INVALID_TIME_ZONE", "Time zone is not recognized");
    const current = await prisma.desktopPreference.findUnique({ where: { userId: request.currentUser.id } });
    const nextDndEnabled = input.doNotDisturbEnabled ?? current?.doNotDisturbEnabled ?? false;
    const nextDndStart = input.doNotDisturbStart !== undefined ? input.doNotDisturbStart : current?.doNotDisturbStart ?? null;
    const nextDndEnd = input.doNotDisturbEnd !== undefined ? input.doNotDisturbEnd : current?.doNotDisturbEnd ?? null;
    if (nextDndEnabled && (!nextDndStart || !nextDndEnd || nextDndStart === nextDndEnd)) {
      throw new ApiError(400, "INVALID_DO_NOT_DISTURB", "Do-not-disturb requires different start and end times");
    }
    const preferenceData = {
      ...(input.systemNotificationsEnabled !== undefined ? { systemNotificationsEnabled: input.systemNotificationsEnabled } : {}),
      ...(input.assignmentNotificationsEnabled !== undefined ? { assignmentNotificationsEnabled: input.assignmentNotificationsEnabled } : {}),
      ...(input.mentionNotificationsEnabled !== undefined ? { mentionNotificationsEnabled: input.mentionNotificationsEnabled } : {}),
      ...(input.statusNotificationsEnabled !== undefined ? { statusNotificationsEnabled: input.statusNotificationsEnabled } : {}),
      ...(input.assigneeNotificationsEnabled !== undefined ? { assigneeNotificationsEnabled: input.assigneeNotificationsEnabled } : {}),
      ...(input.commentNotificationsEnabled !== undefined ? { commentNotificationsEnabled: input.commentNotificationsEnabled } : {}),
      ...(input.doNotDisturbEnabled !== undefined ? { doNotDisturbEnabled: input.doNotDisturbEnabled } : {}),
      ...(input.doNotDisturbStart !== undefined ? { doNotDisturbStart: input.doNotDisturbStart } : {}),
      ...(input.doNotDisturbEnd !== undefined ? { doNotDisturbEnd: input.doNotDisturbEnd } : {}),
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
      ...(input.recentlyClosedDays !== undefined ? { recentlyClosedDays: input.recentlyClosedDays } : {}),
    } satisfies Prisma.DesktopPreferenceUncheckedUpdateInput;
    const preference = await prisma.desktopPreference.upsert({
      where: { userId: request.currentUser.id },
      update: preferenceData,
      create: { userId: request.currentUser.id, ...preferenceData },
    });
    app.realtime.publish([request.currentUser.id], { type: "preferences.changed", updatedAt: preference.updatedAt.toISOString() });
    const { userId: _, createdAt: __, ...result } = preference;
    return result;
  });

  app.get("/desktop/notification-mutes", { preHandler: app.authenticate }, async (request) => ({
    issueIds: (await prisma.issueNotificationMute.findMany({
      where: { userId: request.currentUser.id },
      select: { issueId: true },
      orderBy: { issueId: "asc" },
    })).map(({ issueId }) => issueId),
  }));

  app.put("/issues/:id/notification-mute", { preHandler: app.authenticate }, async (request) => {
    const issueId = parseId((request.params as { id: string }).id);
    const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true, updatedAt: true } });
    if (!issue) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    const mute = await prisma.issueNotificationMute.upsert({
      where: { userId_issueId: { userId: request.currentUser.id, issueId } },
      update: {},
      create: { userId: request.currentUser.id, issueId },
    });
    app.realtime.publish([request.currentUser.id], { type: "notification-mute.changed", issueId, muted: true });
    return { issueId, muted: true, createdAt: mute.createdAt };
  });

  app.delete("/issues/:id/notification-mute", { preHandler: app.authenticate }, async (request) => {
    const issueId = parseId((request.params as { id: string }).id);
    const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true, updatedAt: true } });
    if (!issue) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    await prisma.issueNotificationMute.deleteMany({ where: { userId: request.currentUser.id, issueId } });
    app.realtime.publish([request.currentUser.id], { type: "notification-mute.changed", issueId, muted: false });
    return { issueId, muted: false, createdAt: null };
  });
}
