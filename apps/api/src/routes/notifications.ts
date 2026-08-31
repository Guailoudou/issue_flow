import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { parseId } from "../utils";

export async function notificationRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/notifications", { preHandler: app.authenticate }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; unread?: string };
    const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const where = { userId: request.currentUser.id, ...(query.unread === "true" ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { issue: { select: { id: true, title: true, state: true } } } }),
      prisma.notification.count({ where }), prisma.notification.count({ where: { userId: request.currentUser.id, readAt: null } }),
    ]);
    return { items, unread, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  });
  app.patch("/notifications/:id/read", { preHandler: app.authenticate }, async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const result = await prisma.notification.updateMany({ where: { id, userId: request.currentUser.id }, data: { readAt: new Date() } });
    if (!result.count) return { ok: false };
    return { ok: true };
  });
  app.patch("/notifications/issues/:issueId/read", { preHandler: app.authenticate }, async (request) => {
    const issueId = parseId((request.params as { issueId: string }).issueId);
    const result = await prisma.notification.updateMany({ where: { issueId, userId: request.currentUser.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, count: result.count };
  });
  app.post("/notifications/read-all", { preHandler: app.authenticate }, async (request) => {
    const result = await prisma.notification.updateMany({ where: { userId: request.currentUser.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, count: result.count };
  });
}
