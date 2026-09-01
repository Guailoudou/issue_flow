import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { commentSchema, updateCommentSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { isAdmin, issueRelatedUserIds, mentionIds, notifyIssue, parseId, publishNotifications, timelineData } from "../utils";

const authorSelect = { id: true, username: true, displayName: true, email: true, role: true, active: true, createdAt: true, updatedAt: true } as const;

export async function commentRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const publishIssueChanged = async (issueId: number, updatedAt: Date, actorId: number) => {
    try {
      const userIds = await issueRelatedUserIds(prisma, issueId, [actorId]);
      app.realtime.publish(userIds, { type: "issue.changed", issueId, updatedAt: updatedAt.toISOString(), actorId });
    } catch (error) {
      app.log.warn({ err: error, issueId }, "Realtime issue publication failed after comment commit");
    }
  };

  app.post("/issues/:id/comments", { preHandler: app.authenticate }, async (request, reply) => {
    const issueId = parseId((request.params as { id: string }).id);
    const { body } = commentSchema.parse(request.body);
    if (!(await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true } }))) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    const mentioned = await mentionIds(prisma, body);
    const { comment, issueUpdatedAt, notifications } = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({ data: { issueId, authorId: request.currentUser.id, body }, include: { author: { select: authorSelect } } });
      const issue = await tx.issue.update({ where: { id: issueId }, data: { updatedAt: new Date() }, select: { updatedAt: true } });
      await tx.subscription.upsert({ where: { issueId_userId: { issueId, userId: request.currentUser.id } }, update: {}, create: { issueId, userId: request.currentUser.id } });
      for (const userId of mentioned) await tx.subscription.upsert({ where: { issueId_userId: { issueId, userId } }, update: {}, create: { issueId, userId } });
      await tx.timelineEvent.create({ data: { issueId, actorId: request.currentUser.id, type: "COMMENT_CREATED", data: timelineData({ commentId: created.id }) } });
      const notifications = await notifyIssue(tx, issueId, request.currentUser.id, "COMMENT", `New comment on issue #${issueId}`, mentioned, "MENTIONED", `You were mentioned on issue #${issueId}`);
      return { comment: created, issueUpdatedAt: issue.updatedAt, notifications };
    });
    publishNotifications(app.realtime, notifications);
    for (const userId of mentioned) app.realtime.publish([userId], { type: "subscription.changed", issueId, subscribed: true });
    await publishIssueChanged(issueId, issueUpdatedAt, request.currentUser.id);
    reply.status(201);
    return comment;
  });

  app.patch("/comments/:id", { preHandler: app.authenticate }, async (request) => {
    const id = parseId((request.params as { id: string }).id); const input = updateCommentSchema.parse(request.body);
    const old = await prisma.comment.findUnique({ where: { id } });
    if (!old || old.deletedAt) throw new ApiError(404, "COMMENT_NOT_FOUND", "Comment not found");
    if (!isAdmin(request.currentUser) && old.authorId !== request.currentUser.id) throw new ApiError(403, "FORBIDDEN", "You cannot edit this comment");
    if (input.updatedAt && old.updatedAt.getTime() !== new Date(input.updatedAt).getTime()) throw new ApiError(409, "STALE_UPDATE", "Comment was changed by another user; refresh and retry");
    const mentioned = await mentionIds(prisma, input.body);
    const { comment, issueUpdatedAt, notifications } = await prisma.$transaction(async (tx) => {
      const updated = await tx.comment.update({ where: { id }, data: { body: input.body }, include: { author: { select: authorSelect } } });
      const issue = await tx.issue.update({ where: { id: old.issueId }, data: { updatedAt: new Date() }, select: { updatedAt: true } });
      for (const userId of mentioned) await tx.subscription.upsert({ where: { issueId_userId: { issueId: old.issueId, userId } }, update: {}, create: { issueId: old.issueId, userId } });
      await tx.timelineEvent.create({ data: { issueId: old.issueId, actorId: request.currentUser.id, type: "COMMENT_EDITED", data: timelineData({ commentId: id }) } });
      const notifications = await notifyIssue(tx, old.issueId, request.currentUser.id, "COMMENT_EDITED", `A comment on issue #${old.issueId} was edited`, mentioned, "MENTIONED", `You were mentioned on issue #${old.issueId}`);
      return { comment: updated, issueUpdatedAt: issue.updatedAt, notifications };
    });
    publishNotifications(app.realtime, notifications);
    for (const userId of mentioned) app.realtime.publish([userId], { type: "subscription.changed", issueId: old.issueId, subscribed: true });
    await publishIssueChanged(old.issueId, issueUpdatedAt, request.currentUser.id);
    return comment;
  });

  app.delete("/comments/:id", { preHandler: app.authenticate }, async (request) => {
    const id = parseId((request.params as { id: string }).id); const old = await prisma.comment.findUnique({ where: { id } });
    if (!old || old.deletedAt) throw new ApiError(404, "COMMENT_NOT_FOUND", "Comment not found");
    if (!isAdmin(request.currentUser) && old.authorId !== request.currentUser.id) throw new ApiError(403, "FORBIDDEN", "You cannot delete this comment");
    const { issueUpdatedAt, notifications } = await prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id }, data: { deletedAt: new Date() } });
      const issue = await tx.issue.update({ where: { id: old.issueId }, data: { updatedAt: new Date() }, select: { updatedAt: true } });
      await tx.timelineEvent.create({ data: { issueId: old.issueId, actorId: request.currentUser.id, type: "COMMENT_DELETED", data: timelineData({ commentId: id }) } });
      const notifications = await notifyIssue(tx, old.issueId, request.currentUser.id, "COMMENT_DELETED", `A comment on issue #${old.issueId} was deleted`);
      return { issueUpdatedAt: issue.updatedAt, notifications };
    });
    publishNotifications(app.realtime, notifications);
    await publishIssueChanged(old.issueId, issueUpdatedAt, request.currentUser.id);
    return { ok: true };
  });
}
