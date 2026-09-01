import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { adminPlatformSettingSchema, commitActionSchema, createUserSchema, labelSchema, milestoneSchema, resetPasswordSchema, updateUserRolesSchema, updateUserSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { parseId, publicUser } from "../utils";
import { encryptAiApiKey, type AiOptions } from "../ai/labeler";

const publicSettingSelect = { name: true, description: true, logoUrl: true, defaultPageSize: true, allowUserCreateIssue: true } as const;
const adminSettingView = ({ aiApiKeyEncrypted, ...setting }: Awaited<ReturnType<PrismaClient["platformSetting"]["findUniqueOrThrow"]>>) => ({ ...setting, hasAiApiKey: !!aiApiKeyEncrypted });

export async function adminRoutes(app: FastifyInstance, prisma: PrismaClient, aiOptions: AiOptions = {}) {
  app.get("/settings", async () => prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 }, select: publicSettingSelect }));
  app.get("/admin/settings", { preHandler: app.requireAdmin }, async () => adminSettingView(await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } })));
  app.put("/admin/settings", { preHandler: app.requireAdmin }, async (request) => {
    const input = adminPlatformSettingSchema.parse(request.body);
    const current = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
    const { aiApiKey, clearAiApiKey, ...data } = input;
    const aiApiKeyEncrypted = clearAiApiKey ? null : aiApiKey ? encryptAiApiKey(aiApiKey, aiOptions) : current.aiApiKeyEncrypted;
    return adminSettingView(await prisma.platformSetting.update({ where: { id: 1 }, data: { ...data, aiApiKeyEncrypted } }));
  });

  app.get("/users", { preHandler: app.authenticate }, async () => {
    const users = await prisma.user.findMany({ orderBy: { username: "asc" }, include: { businessRoles: true } });
    return { items: users.map(publicUser) };
  });
  app.post("/admin/users", { preHandler: app.requireAdmin }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    const { password, ...profile } = input;
    const user = await prisma.user.create({ data: { ...profile, email: profile.email || null, passwordHash: await bcrypt.hash(password, 12), businessRoles: { create: { role: "DEVELOPMENT" } } }, include: { businessRoles: true } });
    reply.status(201);
    return { user: publicUser(user) };
  });
  app.patch("/admin/users/:id", { preHandler: app.requireAdmin }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const input = updateUserSchema.parse(request.body);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
    if (target.id === request.currentUser.id && input.username !== undefined) throw new ApiError(409, "ADMIN_SELF_RENAME_FORBIDDEN", "Use another administrator account to change this username");
    if (target.role === "ADMIN" && input.active === false) throw new ApiError(409, "ADMIN_REQUIRED", "The unique administrator cannot be disabled");
    const data = {
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.email !== undefined ? { email: input.email || null } : {}),
    };
    const user = input.active === false
      ? await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data, include: { businessRoles: true } });
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.apiToken.deleteMany({ where: { userId: id } });
        return updated;
      })
      : await prisma.user.update({ where: { id }, data, include: { businessRoles: true } });
    if (input.active === false) app.realtime.disconnectUser(id);
    return { user: publicUser(user) };
  });
  app.put("/admin/users/:id/roles", { preHandler: app.authenticate }, async (request) => {
    if (request.currentUser.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Only administrators can change user roles");
    const id = parseId((request.params as { id: string }).id);
    const { roles } = updateUserRolesSchema.parse(request.body);
    if (!(await prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
    const user = await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: [...new Set(roles)].map((role) => ({ userId: id, role })) });
      return tx.user.findUniqueOrThrow({ where: { id }, include: { businessRoles: true } });
    });
    return { user: publicUser(user) };
  });
  app.post("/admin/users/:id/reset-password", { preHandler: app.requireAdmin }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const { password } = resetPasswordSchema.parse(request.body);
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 12) } }),
      prisma.session.deleteMany({ where: { userId: id } }),
      prisma.apiToken.deleteMany({ where: { userId: id } }),
    ]);
    app.realtime.disconnectUser(id);
    return { ok: true };
  });
  app.delete("/admin/users/:id", { preHandler: app.requireAdmin }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const target = await prisma.user.findUnique({ where: { id }, include: { _count: { select: { issues: true, comments: true, assignments: true, events: true } } } });
    if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
    if (target.role === "ADMIN") throw new ApiError(409, "ADMIN_REQUIRED", "The unique administrator cannot be deleted");
    if (Object.values(target._count).some((count) => count > 0)) throw new ApiError(409, "USER_HAS_HISTORY", "Users with activity history must be disabled instead of deleted");
    await prisma.user.delete({ where: { id } });
    app.realtime.disconnectUser(id);
    return { ok: true };
  });

  app.get("/labels", { preHandler: app.authenticate }, async () => ({ items: (await prisma.label.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { issues: true } } } })).map(({ _count, ...label }) => ({ ...label, issueCount: _count.issues })) }));
  app.post("/admin/labels", { preHandler: app.requireAdmin }, async (request, reply) => { reply.status(201); return prisma.label.create({ data: labelSchema.parse(request.body) }); });
  app.put("/admin/labels/:id", { preHandler: app.requireAdmin }, async (request) => prisma.label.update({ where: { id: parseId((request.params as { id: string }).id) }, data: labelSchema.parse(request.body) }));
  app.delete("/admin/labels/:id", { preHandler: app.requireAdmin }, async (request) => { await prisma.label.delete({ where: { id: parseId((request.params as { id: string }).id) } }); return { ok: true }; });

  app.get("/admin/commit-actions", { preHandler: app.requireAdmin }, async () => ({
    items: await prisma.commitAction.findMany({ orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }], include: { labels: { include: { label: true } } } }),
  }));
  app.post("/admin/commit-actions", { preHandler: app.requireAdmin }, async (request, reply) => {
    const input = commitActionSchema.parse(request.body);
    const labelIds = [...new Set(input.labelIds)];
    if (await prisma.label.count({ where: { id: { in: labelIds } } }) !== labelIds.length) throw new ApiError(400, "INVALID_LABEL", "One or more labels do not exist");
    reply.status(201);
    return prisma.commitAction.create({ data: { name: input.name, keyword: input.keyword, state: input.state, labels: { create: labelIds.map((labelId) => ({ labelId })) } }, include: { labels: { include: { label: true } } } });
  });
  app.put("/admin/commit-actions/:id", { preHandler: app.requireAdmin }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const input = commitActionSchema.parse(request.body);
    const labelIds = [...new Set(input.labelIds)];
    if (await prisma.label.count({ where: { id: { in: labelIds } } }) !== labelIds.length) throw new ApiError(400, "INVALID_LABEL", "One or more labels do not exist");
    return prisma.$transaction(async (tx) => {
      await tx.commitAction.update({ where: { id }, data: { name: input.name, keyword: input.keyword, state: input.state } });
      await tx.commitActionLabel.deleteMany({ where: { actionId: id } });
      if (labelIds.length) await tx.commitActionLabel.createMany({ data: labelIds.map((labelId) => ({ actionId: id, labelId })) });
      return tx.commitAction.findUniqueOrThrow({ where: { id }, include: { labels: { include: { label: true } } } });
    });
  });
  app.delete("/admin/commit-actions/:id", { preHandler: app.requireAdmin }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const action = await prisma.commitAction.findUnique({ where: { id } });
    if (!action) throw new ApiError(404, "COMMIT_ACTION_NOT_FOUND", "Commit action not found");
    if (action.isSystem) throw new ApiError(409, "SYSTEM_COMMIT_ACTION", "System commit actions cannot be deleted");
    await prisma.commitAction.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/milestones", { preHandler: app.authenticate }, async () => ({ items: await prisma.milestone.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { issues: true } } } }) }));
  app.post("/admin/milestones", { preHandler: app.requireAdmin }, async (request, reply) => {
    const input = milestoneSchema.parse(request.body); reply.status(201);
    return prisma.milestone.create({ data: { ...input, dueDate: input.dueDate ? new Date(input.dueDate) : null } });
  });
  app.put("/admin/milestones/:id", { preHandler: app.requireAdmin }, async (request) => {
    const input = milestoneSchema.parse(request.body);
    return prisma.milestone.update({ where: { id: parseId((request.params as { id: string }).id) }, data: { ...input, dueDate: input.dueDate ? new Date(input.dueDate) : null } });
  });
  app.delete("/admin/milestones/:id", { preHandler: app.requireAdmin }, async (request) => { await prisma.milestone.delete({ where: { id: parseId((request.params as { id: string }).id) } }); return { ok: true }; });

  app.get("/admin/stats", { preHandler: app.requireAdmin }, async () => {
    const since = new Date(Date.now() - 7 * 86400000);
    const [users, activeUsers, openIssues, closedIssues, recentIssues, recentComments, activity] = await Promise.all([
      prisma.user.count(), prisma.user.count({ where: { active: true } }), prisma.issue.count({ where: { state: "OPEN" } }),
      prisma.issue.count({ where: { state: "CLOSED" } }), prisma.issue.count({ where: { createdAt: { gte: since } } }),
      prisma.comment.count({ where: { createdAt: { gte: since } } }), prisma.timelineEvent.findMany({ take: 10, orderBy: { createdAt: "desc" }, include: { actor: true, issue: { select: { id: true, title: true } } } }),
    ]);
    return { users, activeUsers, openIssues, closedIssues, recentIssues, recentComments, activity: activity.map((event) => ({ ...event, actor: publicUser(event.actor), data: JSON.parse(event.data) })) };
  });
}
