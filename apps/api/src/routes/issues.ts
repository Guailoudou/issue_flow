import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { createIssueSchema, issueQuerySchema, subscriptionSchema, updateIssueSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { issueAccess, notifyIssue, parseId, timelineData } from "../utils";

const userSelect = { id: true, username: true, displayName: true, email: true, role: true, active: true, createdAt: true, updatedAt: true } as const;
const issueInclude = {
  author: { select: userSelect }, milestone: true,
  assignees: { include: { user: { select: userSelect } } },
  labels: { include: { label: true } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} as const;

async function validateRelations(prisma: PrismaClient, assigneeIds?: number[], labelIds?: number[], milestoneId?: number | null) {
  if (assigneeIds) {
    const count = await prisma.user.count({ where: { id: { in: [...new Set(assigneeIds)] }, active: true } });
    if (count !== new Set(assigneeIds).size) throw new ApiError(400, "INVALID_ASSIGNEE", "Every assignee must be an active user");
  }
  if (labelIds) {
    const count = await prisma.label.count({ where: { id: { in: [...new Set(labelIds)] } } });
    if (count !== new Set(labelIds).size) throw new ApiError(400, "INVALID_LABEL", "One or more labels do not exist");
  }
  if (milestoneId) {
    if (!(await prisma.milestone.findUnique({ where: { id: milestoneId } }))) throw new ApiError(400, "INVALID_MILESTONE", "Milestone does not exist");
  }
}

const diff = (oldIds: number[], nextIds: number[]) => ({ added: nextIds.filter((id) => !oldIds.includes(id)), removed: oldIds.filter((id) => !nextIds.includes(id)) });

export async function issueRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/issues", { preHandler: app.authenticate }, async (request) => {
    const query = issueQuerySchema.parse(request.query);
    const setting = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
    const pageSize = query.pageSize ?? setting.defaultPageSize;
    const where: Prisma.IssueWhereInput = {
      ...(query.state ? { state: query.state === "OPEN" ? { in: ["OPEN", "AWAITING_ACCEPTANCE"] } : query.state } : {}), ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(query.assigneeId ? { assignees: { some: { userId: query.assigneeId } } } : {}),
      ...(query.labelId ? { labels: { some: { labelId: query.labelId } } } : {}),
      ...(query.milestoneId ? { milestoneId: query.milestoneId } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q } }, { body: { contains: query.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.issue.findMany({ where, include: issueInclude, orderBy: { [query.sort]: query.order }, skip: (query.page - 1) * pageSize, take: pageSize }),
      prisma.issue.count({ where }),
    ]);
    return { items, pagination: { page: query.page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  });

  app.get("/issues/:id", { preHandler: app.authenticate }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const issue = await prisma.issue.findUnique({ where: { id }, include: { ...issueInclude,
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: userSelect } } },
      timeline: { orderBy: { createdAt: "asc" }, include: { actor: { select: userSelect } } },
      subscriptions: { where: { userId: request.currentUser.id }, select: { userId: true } },
    } });
    if (!issue) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    return {
      ...issue, subscribed: issue.subscriptions.length > 0, subscriptions: undefined,
      comments: issue.comments.map((comment) => comment.deletedAt ? { ...comment, body: "", deleted: true } : { ...comment, deleted: false }),
      timeline: issue.timeline.map((event) => ({ ...event, data: JSON.parse(event.data) })),
    };
  });

  app.post("/issues", { preHandler: app.authenticate }, async (request, reply) => {
    const input = createIssueSchema.parse(request.body);
    const setting = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
    if (request.currentUser.role !== "ADMIN" && !setting.allowUserCreateIssue) throw new ApiError(403, "ISSUE_CREATION_DISABLED", "Issue creation is disabled");
    await validateRelations(prisma, input.assigneeIds, input.labelIds, input.milestoneId);
    const issue = await prisma.$transaction(async (tx) => {
      const created = await tx.issue.create({ data: {
        title: input.title, body: input.body, authorId: request.currentUser.id, milestoneId: input.milestoneId ?? null,
        assignees: { create: [...new Set(input.assigneeIds ?? [])].map((userId) => ({ userId })) },
        labels: { create: [...new Set(input.labelIds ?? [])].map((labelId) => ({ labelId })) },
      }, include: issueInclude });
      await tx.subscription.create({ data: { issueId: created.id, userId: request.currentUser.id } });
      for (const userId of new Set(input.assigneeIds ?? [])) await tx.subscription.upsert({ where: { issueId_userId: { issueId: created.id, userId } }, update: {}, create: { issueId: created.id, userId } });
      await tx.timelineEvent.create({ data: { issueId: created.id, actorId: request.currentUser.id, type: "ISSUE_CREATED", data: timelineData({ title: created.title }) } });
      return created;
    });
    await notifyIssue(prisma, issue.id, request.currentUser.id, "ASSIGNED", `You were assigned to #${issue.id}`, input.assigneeIds);
    reply.status(201);
    return issue;
  });

  app.patch("/issues/:id", { preHandler: app.authenticate }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const input = updateIssueSchema.parse(request.body);
    const editsContent = input.title !== undefined || input.body !== undefined;
    const old = await issueAccess(prisma, id, request.currentUser, editsContent ? "edit" : "manage");
    await validateRelations(prisma, input.assigneeIds, input.labelIds, input.milestoneId);
    const oldAssignees = old.assignees.map((item) => item.userId);
    const oldLabels = await prisma.issueLabel.findMany({ where: { issueId: id }, select: { labelId: true } });
    const assigneeChange = input.assigneeIds ? diff(oldAssignees, [...new Set(input.assigneeIds)]) : null;
    const labelChange = input.labelIds ? diff(oldLabels.map((item) => item.labelId), [...new Set(input.labelIds)]) : null;
    const issue = await prisma.$transaction(async (tx) => {
      const changed = await tx.issue.updateMany({ where: { id, updatedAt: new Date(input.updatedAt) }, data: {
        ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.state !== undefined ? { state: input.state, closedAt: input.state === "CLOSED" ? new Date() : null } : {}),
        ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}), updatedAt: new Date(),
      } });
      if (!changed.count) throw new ApiError(409, "STALE_UPDATE", "Issue was changed by another user; refresh and retry");
      if (input.assigneeIds) { await tx.issueAssignee.deleteMany({ where: { issueId: id } }); await tx.issueAssignee.createMany({ data: [...new Set(input.assigneeIds)].map((userId) => ({ issueId: id, userId })) }); }
      if (input.labelIds) { await tx.issueLabel.deleteMany({ where: { issueId: id } }); await tx.issueLabel.createMany({ data: [...new Set(input.labelIds)].map((labelId) => ({ issueId: id, labelId })) }); }
      const events: { type: string; data: unknown }[] = [];
      if (input.title !== undefined || input.body !== undefined) events.push({ type: "ISSUE_EDITED", data: { titleChanged: input.title !== undefined && input.title !== old.title, bodyChanged: input.body !== undefined && input.body !== old.body } });
      if (input.state && input.state !== old.state) events.push({
        type: input.state === "CLOSED" ? "ISSUE_CLOSED" : input.state === "AWAITING_ACCEPTANCE" ? "ISSUE_AWAITING_ACCEPTANCE" : "ISSUE_REOPENED",
        data: { from: old.state, to: input.state },
      });
      if (assigneeChange && (assigneeChange.added.length || assigneeChange.removed.length)) events.push({ type: "ASSIGNEES_CHANGED", data: assigneeChange });
      if (labelChange && (labelChange.added.length || labelChange.removed.length)) events.push({ type: "LABELS_CHANGED", data: labelChange });
      if (input.milestoneId !== undefined && input.milestoneId !== old.milestoneId) events.push({ type: "MILESTONE_CHANGED", data: { from: old.milestoneId, to: input.milestoneId } });
      if (events.length) await tx.timelineEvent.createMany({ data: events.map((event) => ({ issueId: id, actorId: request.currentUser.id, type: event.type, data: timelineData(event.data) })) });
      for (const userId of assigneeChange?.added ?? []) await tx.subscription.upsert({ where: { issueId_userId: { issueId: id, userId } }, update: {}, create: { issueId: id, userId } });
      return tx.issue.findUniqueOrThrow({ where: { id }, include: issueInclude });
    });
    const eventType = input.state && input.state !== old.state ? "STATE_CHANGED" : assigneeChange ? "ASSIGNEES_CHANGED" : "ISSUE_UPDATED";
    await notifyIssue(prisma, id, request.currentUser.id, eventType, `Issue #${id} was updated`, assigneeChange?.added);
    return issue;
  });

  app.put("/issues/:id/subscription", { preHandler: app.authenticate }, async (request) => {
    const issueId = parseId((request.params as { id: string }).id); const { subscribed } = subscriptionSchema.parse(request.body);
    if (!(await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true } }))) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    if (subscribed) await prisma.subscription.upsert({ where: { issueId_userId: { issueId, userId: request.currentUser.id } }, update: {}, create: { issueId, userId: request.currentUser.id } });
    else await prisma.subscription.deleteMany({ where: { issueId, userId: request.currentUser.id } });
    return { subscribed };
  });
}
