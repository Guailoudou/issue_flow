import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../errors";
import { parseId, timelineData } from "../utils";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;
const uploaderSelect = { id: true, username: true, displayName: true, email: true, role: true, active: true, createdAt: true, updatedAt: true } as const;

export interface AttachmentRouteOptions { uploadDir?: string }

function defaultUploadDir() {
  const cwd = process.cwd();
  return path.resolve(cwd, path.basename(cwd) === "api" ? "uploads" : "apps/api/uploads");
}

export function resolveUploadDir(option?: string) {
  return path.resolve(option || process.env.UPLOAD_DIR || defaultUploadDir());
}

const PREVIEWABLE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const isPreviewableImageMime = (mimeType: string) => PREVIEWABLE_IMAGE_MIMES.has(mimeType.toLowerCase());

function normalizedMimeType(value: string | undefined) {
  const mimeType = value?.trim().toLowerCase() ?? "";
  return mimeType.length <= 255 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType) ? mimeType : "application/octet-stream";
}

export function resolveAttachmentPath(uploadDir: string, storageName: string) {
  if (!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|bin)$/.test(storageName)) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
  const candidate = path.resolve(uploadDir, storageName);
  if (!candidate.startsWith(`${uploadDir}${path.sep}`)) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
  return candidate;
}

function serializeAttachment(attachment: {
  id: number; issueId: number; uploaderId: number; fileName: string; mimeType: string; size: number; createdAt: Date;
  uploader: typeof uploaderSelect extends never ? never : Record<string, unknown>;
}, currentUser: { id: number; role: string }, issueAuthorId: number) {
  return {
    id: attachment.id,
    issueId: attachment.issueId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: `/api/attachments/${attachment.id}/content`,
    createdAt: attachment.createdAt,
    uploader: attachment.uploader,
    canDelete: currentUser.role === "ADMIN" || currentUser.id === attachment.uploaderId || currentUser.id === issueAuthorId,
  };
}

export async function attachmentRoutes(app: FastifyInstance, prisma: PrismaClient, options: AttachmentRouteOptions = {}) {
  const uploadDir = resolveUploadDir(options.uploadDir);

  app.get("/issues/:id/attachments", { preHandler: app.authenticate }, async (request) => {
    const issueId = parseId((request.params as { id: string }).id);
    const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { authorId: true } });
    if (!issue) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    const attachments = await prisma.issueAttachment.findMany({ where: { issueId }, orderBy: { createdAt: "asc" }, include: { uploader: { select: uploaderSelect } } });
    return { attachments: attachments.map((attachment) => serializeAttachment(attachment, request.currentUser, issue.authorId)) };
  });

  app.post("/issues/:id/attachments", { preHandler: app.authenticate }, async (request, reply) => {
    const issueId = parseId((request.params as { id: string }).id);
    const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { authorId: true } });
    if (!issue) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    if (await prisma.issueAttachment.count({ where: { issueId } }) >= MAX_ATTACHMENTS) throw new ApiError(409, "ATTACHMENT_LIMIT_REACHED", `Each issue can contain at most ${MAX_ATTACHMENTS} attachments`);

    let part;
    try {
      part = await request.file({ limits: { files: 1, fileSize: MAX_FILE_SIZE, parts: 2 } });
    } catch (error) {
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new ApiError(413, "ATTACHMENT_TOO_LARGE", "Attachment must not exceed 10 MiB");
      throw error;
    }
    if (!part || part.fieldname !== "file") throw new ApiError(400, "ATTACHMENT_FILE_REQUIRED", "Multipart field 'file' is required");
    const originalName = part.filename;
    if (!originalName || originalName.length > 255 || Buffer.byteLength(originalName, "utf8") > 255 || /[\u0000-\u001f\u007f]/.test(originalName)
      || originalName.includes("/") || originalName.includes("\\") || path.basename(originalName) !== originalName) {
      throw new ApiError(400, "INVALID_ATTACHMENT_NAME", "Invalid attachment file name");
    }
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (error) {
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new ApiError(413, "ATTACHMENT_TOO_LARGE", "Attachment must not exceed 10 MiB");
      throw error;
    }
    if (!buffer.length) throw new ApiError(400, "INVALID_ATTACHMENT", "Attachment is empty");
    const mimeType = normalizedMimeType(part.mimetype);

    const storageName = `${randomUUID()}.bin`;
    const filePath = resolveAttachmentPath(uploadDir, storageName);
    await mkdir(uploadDir, { recursive: true });
    await writeFile(filePath, buffer, { flag: "wx" });
    try {
      const attachment = await prisma.$transaction(async (tx) => {
        const count = await tx.issueAttachment.count({ where: { issueId } });
        if (count >= MAX_ATTACHMENTS) throw new ApiError(409, "ATTACHMENT_LIMIT_REACHED", `Each issue can contain at most ${MAX_ATTACHMENTS} attachments`);
        const created = await tx.issueAttachment.create({ data: {
          issueId, uploaderId: request.currentUser.id, fileName: originalName, storageName, mimeType, size: buffer.length,
        }, include: { uploader: { select: uploaderSelect } } });
        await tx.timelineEvent.create({ data: { issueId, actorId: request.currentUser.id, type: "ATTACHMENT_ADDED", data: timelineData({ attachmentId: created.id, fileName: originalName }) } });
        return created;
      });
      reply.status(201);
      return serializeAttachment(attachment, request.currentUser, issue.authorId);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  });

  app.get("/attachments/:id/content", { preHandler: app.authenticate }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    const attachment = await prisma.issueAttachment.findUnique({ where: { id } });
    if (!attachment) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
    const filePath = resolveAttachmentPath(uploadDir, attachment.storageName);
    let fileStat;
    try { fileStat = await stat(filePath); }
    catch { throw new ApiError(404, "ATTACHMENT_CONTENT_NOT_FOUND", "Attachment content not found"); }
    if (!fileStat.isFile()) throw new ApiError(404, "ATTACHMENT_CONTENT_NOT_FOUND", "Attachment content not found");
    reply.header("Content-Type", attachment.mimeType);
    reply.header("Content-Length", fileStat.size);
    reply.header("Content-Disposition", `${isPreviewableImageMime(attachment.mimeType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(createReadStream(filePath));
  });

  app.delete("/attachments/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    const attachment = await prisma.issueAttachment.findUnique({ where: { id }, include: { issue: { select: { authorId: true } } } });
    if (!attachment) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
    if (request.currentUser.role !== "ADMIN" && request.currentUser.id !== attachment.uploaderId && request.currentUser.id !== attachment.issue.authorId) {
      throw new ApiError(403, "FORBIDDEN", "You do not have permission to delete this attachment");
    }
    await prisma.$transaction([
      prisma.issueAttachment.delete({ where: { id } }),
      prisma.timelineEvent.create({ data: { issueId: attachment.issueId, actorId: request.currentUser.id, type: "ATTACHMENT_REMOVED", data: timelineData({ attachmentId: id, fileName: attachment.fileName }) } }),
    ]);
    await unlink(resolveAttachmentPath(uploadDir, attachment.storageName)).catch(() => undefined);
    return reply.status(204).send();
  });
}
