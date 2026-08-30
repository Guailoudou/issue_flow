import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { createIssueSchema, issueQuerySchema, subscriptionSchema, updateIssueSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { hasRole, isAdmin, issueAccess, notifyIssue, parseId, timelineData } from "../utils";
import { assignAiLabels, type AiOptions } from "../ai/labeler";

const userSelect = { id: true, username: true, displayName: true, email: true, role: true, active: true, createdAt: true, updatedAt: true, businessRoles: { select: { role: true } } } as const;
const issueInclude = {
  author: { select: userSelect }, milestone: true,
  assignees: { include: { user: { select: userSelect } } },
  labels: { include: { label: true } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} as const;

async function validateRelations(prisma: PrismaClient, productOwnerIds?: number[], developerOwnerIds?: number[], labelIds?: number[], milestoneId?: number | null) {
  for (const [ids, role, label] of [[productOwnerIds, "PRODUCT", "product"], [developerOwnerIds, "DEVELOPMENT", "developer"]] as const) if (ids) {
    const uniqueIds = [...new Set(ids)];
    const count = await prisma.user.count({ where: { id: { in: uniqueIds }, active: true, businessRoles: { some: { role } } } });
    if (count !== uniqueIds.length) throw new ApiError(400, "INVALID_ASSIGNEE", `Every ${label} owner must be active and have the required role`);
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

export async function issueRoutes(app: FastifyInstance, prisma: PrismaClient, aiOptions: AiOptions = {}) {
  // ponytail: in-process queue; use persistent jobs when restart-safe delivery or multi-instance coordination is required.
  let aiLabelQueue = Promise.resolve();

  app.get("/issues", { preHandler: app.authenticate }, async (request) => {
    const query = issueQuerySchema.parse(request.query);
    const setting = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
    const pageSize = query.pageSize ?? setting.defaultPageSize;
    const where: Prisma.IssueWhereInput = {
      ...(query.state ? { state: query.state === "OPEN" ? { in: ["OPEN", "AWAITING_ACCEPTANCE"] } : query.state } : {}), ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(query.assigneeId ? { assignees: { some: { userId: query.assigneeId } } } : {}),
      ...(query.labelIds?.length ? { AND: query.labelIds.map((labelId) => ({ labels: { some: { labelId } } })) } : query.labelId ? { labels: { some: { labelId: query.labelId } } } : {}),
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
    const productOwnerIds = input.productOwnerIds ?? [];
    const developerOwnerIds = input.developerOwnerIds ?? input.assigneeIds ?? [];
    const setting = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
    if (!isAdmin(request.currentUser) && !setting.allowUserCreateIssue) throw new ApiError(403, "ISSUE_CREATION_DISABLED", "Issue creation is disabled");
    await validateRelations(prisma, productOwnerIds, developerOwnerIds, input.labelIds, input.milestoneId);
    const issue = await prisma.$transaction(async (tx) => {
      const created = await tx.issue.create({ data: {
        title: input.title, body: input.body, authorId: request.currentUser.id, milestoneId: input.milestoneId ?? null, isProductIssue: hasRole(request.currentUser, "PRODUCT"),
        assignees: { create: [
          ...[...new Set(productOwnerIds)].map((userId) => ({ userId, ownerType: "PRODUCT" })),
          ...[...new Set(developerOwnerIds)].map((userId) => ({ userId, ownerType: "DEVELOPMENT" })),
        ] },
        labels: { create: [...new Set(input.labelIds ?? [])].map((labelId) => ({ labelId })) },
      }, include: issueInclude });
      await tx.subscription.create({ data: { issueId: created.id, userId: request.currentUser.id } });
      for (const userId of new Set([...productOwnerIds, ...developerOwnerIds])) await tx.subscription.upsert({ where: { issueId_userId: { issueId: created.id, userId } }, update: {}, create: { issueId: created.id, userId } });
      await tx.timelineEvent.create({ data: { issueId: created.id, actorId: request.currentUser.id, type: "ISSUE_CREATED", data: timelineData({ title: created.title }) } });
      return created;
    });
    await notifyIssue(prisma, issue.id, request.currentUser.id, "ASSIGNED", `You were assigned to #${issue.id}`, [...productOwnerIds, ...developerOwnerIds]);
    if (setting.aiEnabled && !input.labelIds?.length) {
      aiLabelQueue = aiLabelQueue.then(async () => {
        await assignAiLabels(prisma, issue, setting, aiOptions);
      }).catch((error) => {
        app.log.warn({ err: error, issueId: issue.id }, "AI issue labeling failed");
      });
    }
    reply.status(201);
    return issue;
  });

  app.patch("/issues/:id", { preHandler: app.authenticate }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const input = updateIssueSchema.parse(request.body);
    const productOwnerIds = input.productOwnerIds;
    const developerOwnerIds = input.developerOwnerIds ?? input.assigneeIds;
    const editsContent = input.title !== undefined || input.body !== undefined;
    const old = await issueAccess(prisma, id, request.currentUser, editsContent ? "edit" : "manage");
    await validateRelations(prisma, productOwnerIds, developerOwnerIds, input.labelIds, input.milestoneId);
    const oldProductOwners = old.assignees.filter((item) => item.ownerType === "PRODUCT").map((item) => item.userId);
    const oldDeveloperOwners = old.assignees.filter((item) => item.ownerType === "DEVELOPMENT").map((item) => item.userId);
    const oldLabels = await prisma.issueLabel.findMany({ where: { issueId: id }, select: { labelId: true } });
    const productOwnerChange = productOwnerIds ? diff(oldProductOwners, [...new Set(productOwnerIds)]) : null;
    const developerOwnerChange = developerOwnerIds ? diff(oldDeveloperOwners, [...new Set(developerOwnerIds)]) : null;
    const labelChange = input.labelIds ? diff(oldLabels.map((item) => item.labelId), [...new Set(input.labelIds)]) : null;
    const issue = await prisma.$transaction(async (tx) => {
      const changed = await tx.issue.updateMany({ where: { id, updatedAt: new Date(input.updatedAt) }, data: {
        ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.state !== undefined ? { state: input.state, closedAt: input.state === "CLOSED" ? new Date() : null } : {}),
        ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}), updatedAt: new Date(),
      } });
      if (!changed.count) throw new ApiError(409, "STALE_UPDATE", "Issue was changed by another user; refresh and retry");
      if (productOwnerIds) { await tx.issueAssignee.deleteMany({ where: { issueId: id, ownerType: "PRODUCT" } }); await tx.issueAssignee.createMany({ data: [...new Set(productOwnerIds)].map((userId) => ({ issueId: id, userId, ownerType: "PRODUCT" })) }); }
      if (developerOwnerIds) { await tx.issueAssignee.deleteMany({ where: { issueId: id, ownerType: "DEVELOPMENT" } }); await tx.issueAssignee.createMany({ data: [...new Set(developerOwnerIds)].map((userId) => ({ issueId: id, userId, ownerType: "DEVELOPMENT" })) }); }
      if (input.labelIds) { await tx.issueLabel.deleteMany({ where: { issueId: id } }); await tx.issueLabel.createMany({ data: [...new Set(input.labelIds)].map((labelId) => ({ issueId: id, labelId })) }); }
      const events: { type: string; data: unknown }[] = [];
      if (input.title !== undefined || input.body !== undefined) events.push({ type: "ISSUE_EDITED", data: { titleChanged: input.title !== undefined && input.title !== old.title, bodyChanged: input.body !== undefined && input.body !== old.body } });
      if (input.state && input.state !== old.state) events.push({
        type: input.state === "CLOSED" ? "ISSUE_CLOSED" : input.state === "AWAITING_ACCEPTANCE" ? "ISSUE_AWAITING_ACCEPTANCE" : "ISSUE_REOPENED",
        data: { from: old.state, to: input.state },
      });
      if ((productOwnerChange && (productOwnerChange.added.length || productOwnerChange.removed.length)) || (developerOwnerChange && (developerOwnerChange.added.length || developerOwnerChange.removed.length))) events.push({ type: "ASSIGNEES_CHANGED", data: { product: productOwnerChange, development: developerOwnerChange } });
      if (labelChange && (labelChange.added.length || labelChange.removed.length)) events.push({ type: "LABELS_CHANGED", data: labelChange });
      if (input.milestoneId !== undefined && input.milestoneId !== old.milestoneId) events.push({ type: "MILESTONE_CHANGED", data: { from: old.milestoneId, to: input.milestoneId } });
      if (events.length) await tx.timelineEvent.createMany({ data: events.map((event) => ({ issueId: id, actorId: request.currentUser.id, type: event.type, data: timelineData(event.data) })) });
      for (const userId of new Set([...(productOwnerChange?.added ?? []), ...(developerOwnerChange?.added ?? [])])) await tx.subscription.upsert({ where: { issueId_userId: { issueId: id, userId } }, update: {}, create: { issueId: id, userId } });
      return tx.issue.findUniqueOrThrow({ where: { id }, include: issueInclude });
    });
    const ownersChanged = productOwnerChange || developerOwnerChange;
    const eventType = input.state && input.state !== old.state ? "STATE_CHANGED" : ownersChanged ? "ASSIGNEES_CHANGED" : "ISSUE_UPDATED";
    await notifyIssue(prisma, id, request.currentUser.id, eventType, `Issue #${id} was updated`, [...(productOwnerChange?.added ?? []), ...(developerOwnerChange?.added ?? [])]);
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
