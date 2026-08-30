import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createUserSchema, labelSchema, milestoneSchema, platformSettingSchema, resetPasswordSchema, updateUserSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { parseId, publicUser } from "../utils";

export async function adminRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/settings", async () => prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } }));
  app.put("/admin/settings", { preHandler: app.requireAdmin }, async (request) => prisma.platformSetting.update({ where: { id: 1 }, data: platformSettingSchema.parse(request.body) }));

  app.get("/users", { preHandler: app.authenticate }, async () => {
    const users = await prisma.user.findMany({ orderBy: { username: "asc" } });
    return { items: users.map(publicUser) };
  });
  app.post("/admin/users", { preHandler: app.requireAdmin }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    const { password, ...profile } = input;
    const user = await prisma.user.create({ data: { ...profile, email: profile.email || null, passwordHash: await bcrypt.hash(password, 12) } });
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
    const user = await prisma.user.update({ where: { id }, data });
    if (input.active === false) await prisma.$transaction([prisma.session.deleteMany({ where: { userId: id } }), prisma.apiToken.deleteMany({ where: { userId: id } })]);
    return { user: publicUser(user) };
  });
  app.post("/admin/users/:id/reset-password", { preHandler: app.requireAdmin }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const { password } = resetPasswordSchema.parse(request.body);
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    await prisma.$transaction([prisma.session.deleteMany({ where: { userId: id } }), prisma.apiToken.deleteMany({ where: { userId: id } })]);
    return { ok: true };
  });
  app.delete("/admin/users/:id", { preHandler: app.requireAdmin }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const target = await prisma.user.findUnique({ where: { id }, include: { _count: { select: { issues: true, comments: true, assignments: true, events: true } } } });
    if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
    if (target.role === "ADMIN") throw new ApiError(409, "ADMIN_REQUIRED", "The unique administrator cannot be deleted");
    if (Object.values(target._count).some((count) => count > 0)) throw new ApiError(409, "USER_HAS_HISTORY", "Users with activity history must be disabled instead of deleted");
    await prisma.user.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/labels", { preHandler: app.authenticate }, async () => ({ items: await prisma.label.findMany({ orderBy: { name: "asc" } }) }));
  app.post("/admin/labels", { preHandler: app.requireAdmin }, async (request, reply) => { reply.status(201); return prisma.label.create({ data: labelSchema.parse(request.body) }); });
  app.put("/admin/labels/:id", { preHandler: app.requireAdmin }, async (request) => prisma.label.update({ where: { id: parseId((request.params as { id: string }).id) }, data: labelSchema.parse(request.body) }));
  app.delete("/admin/labels/:id", { preHandler: app.requireAdmin }, async (request) => { await prisma.label.delete({ where: { id: parseId((request.params as { id: string }).id) } }); return { ok: true }; });

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
      prisma.user.count(), prisma.user.count({ where: { active: true } }), prisma.issue.count({ where: { state: { in: ["OPEN", "AWAITING_ACCEPTANCE"] } } }),
      prisma.issue.count({ where: { state: "CLOSED" } }), prisma.issue.count({ where: { createdAt: { gte: since } } }),
      prisma.comment.count({ where: { createdAt: { gte: since } } }), prisma.timelineEvent.findMany({ take: 10, orderBy: { createdAt: "desc" }, include: { actor: true, issue: { select: { id: true, title: true } } } }),
    ]);
    return { users, activeUsers, openIssues, closedIssues, recentIssues, recentComments, activity: activity.map((event) => ({ ...event, actor: publicUser(event.actor), data: JSON.parse(event.data) })) };
  });
}
