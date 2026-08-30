import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { commentSchema, updateCommentSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { isAdmin, mentionIds, notifyIssue, parseId, timelineData } from "../utils";

const authorSelect = { id: true, username: true, displayName: true, email: true, role: true, active: true, createdAt: true, updatedAt: true } as const;

export async function commentRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post("/issues/:id/comments", { preHandler: app.authenticate }, async (request, reply) => {
    const issueId = parseId((request.params as { id: string }).id);
    const { body } = commentSchema.parse(request.body);
    if (!(await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true } }))) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({ data: { issueId, authorId: request.currentUser.id, body }, include: { author: { select: authorSelect } } });
      await tx.subscription.upsert({ where: { issueId_userId: { issueId, userId: request.currentUser.id } }, update: {}, create: { issueId, userId: request.currentUser.id } });
      await tx.timelineEvent.create({ data: { issueId, actorId: request.currentUser.id, type: "COMMENT_CREATED", data: timelineData({ commentId: created.id }) } });
      return created;
    });
    const mentioned = await mentionIds(prisma, body);
    await notifyIssue(prisma, issueId, request.currentUser.id, "COMMENT", `New comment on issue #${issueId}`, mentioned);
    reply.status(201);
    return comment;
  });

  app.patch("/comments/:id", { preHandler: app.authenticate }, async (request) => {
    const id = parseId((request.params as { id: string }).id); const input = updateCommentSchema.parse(request.body);
    const old = await prisma.comment.findUnique({ where: { id } });
    if (!old || old.deletedAt) throw new ApiError(404, "COMMENT_NOT_FOUND", "Comment not found");
    if (!isAdmin(request.currentUser) && old.authorId !== request.currentUser.id) throw new ApiError(403, "FORBIDDEN", "You cannot edit this comment");
    if (input.updatedAt && old.updatedAt.getTime() !== new Date(input.updatedAt).getTime()) throw new ApiError(409, "STALE_UPDATE", "Comment was changed by another user; refresh and retry");
    const comment = await prisma.$transaction(async (tx) => {
      const updated = await tx.comment.update({ where: { id }, data: { body: input.body }, include: { author: { select: authorSelect } } });
      await tx.timelineEvent.create({ data: { issueId: old.issueId, actorId: request.currentUser.id, type: "COMMENT_EDITED", data: timelineData({ commentId: id }) } });
      return updated;
    });
    const mentioned = await mentionIds(prisma, input.body);
    await notifyIssue(prisma, old.issueId, request.currentUser.id, "COMMENT_EDITED", `A comment on issue #${old.issueId} was edited`, mentioned);
    return comment;
  });

  app.delete("/comments/:id", { preHandler: app.authenticate }, async (request) => {
    const id = parseId((request.params as { id: string }).id); const old = await prisma.comment.findUnique({ where: { id } });
    if (!old || old.deletedAt) throw new ApiError(404, "COMMENT_NOT_FOUND", "Comment not found");
    if (!isAdmin(request.currentUser) && old.authorId !== request.currentUser.id) throw new ApiError(403, "FORBIDDEN", "You cannot delete this comment");
    await prisma.$transaction([
      prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } }),
      prisma.timelineEvent.create({ data: { issueId: old.issueId, actorId: request.currentUser.id, type: "COMMENT_DELETED", data: timelineData({ commentId: id }) } }),
    ]);
    await notifyIssue(prisma, old.issueId, request.currentUser.id, "COMMENT_DELETED", `A comment on issue #${old.issueId} was deleted`);
    return { ok: true };
  });
}
