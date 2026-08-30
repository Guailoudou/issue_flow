import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../errors";
import { deleteAttachmentContent, readAttachmentBuffer, resolveAttachmentPath, resolveUploadDir, type AttachmentRouteOptions } from "./attachments";

const MAX_BACKUP_SIZE = 1024 * 1024 * 1024;
const modelSpecs = [
  ["platformSetting", ["updatedAt"]], ["ossSetting", ["lastTestedAt", "createdAt", "updatedAt"]],
  ["yunxiaoIntegration", ["lastTestedAt", "createdAt", "updatedAt"]], ["user", ["createdAt", "updatedAt"]],
  ["label", ["createdAt", "updatedAt"]], ["milestone", ["dueDate", "createdAt", "updatedAt"]],
  ["commitAction", ["createdAt", "updatedAt"]], ["issue", ["createdAt", "updatedAt", "closedAt"]],
  ["session", ["expiresAt", "createdAt"]], ["apiToken", ["expiresAt", "lastUsedAt", "createdAt"]],
  ["userRole", []], ["issueAssignee", []], ["issueLabel", []], ["commitActionLabel", []],
  ["comment", ["createdAt", "updatedAt", "deletedAt"]], ["timelineEvent", ["createdAt"]],
  ["subscription", ["createdAt"]], ["notification", ["readAt", "createdAt"]],
  ["codeReference", ["createdAt", "updatedAt"]], ["issueAttachment", ["createdAt"]],
  ["webhookDelivery", ["createdAt", "processedAt", "updatedAt"]],
] as const;

type Row = Record<string, unknown>;
interface ModelDelegate {
  findMany(): Promise<Row[]>;
  deleteMany(): Promise<unknown>;
  createMany(args: { data: Row[] }): Promise<unknown>;
}
const delegate = (client: unknown, name: string) => (client as Record<string, ModelDelegate>)[name]!;
const rowsFor = (data: Record<string, Row[]>, name: string) => {
  const rows = data[name];
  if (!rows) throw new ApiError(400, "INVALID_BACKUP", `Backup is missing ${name}`);
  return rows;
};
const rowSchema = z.record(z.string(), z.unknown());
const backupSchema = z.object({
  format: z.literal("issueflow-backup"), version: z.literal(1), exportedAt: z.string(),
  data: z.record(z.string(), z.array(rowSchema)),
  attachmentContents: z.array(z.object({ attachmentId: z.number().int().positive(), contentBase64: z.string() })),
});

function restoredRows(rows: Row[], dateFields: readonly string[]) {
  return rows.map((source) => {
    const row = { ...source };
    for (const field of dateFields) {
      if (row[field] === null || row[field] === undefined) continue;
      const date = new Date(String(row[field]));
      if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_BACKUP", `Invalid date in ${field}`);
      row[field] = date;
    }
    return row;
  });
}

export async function backupRoutes(app: FastifyInstance, prisma: PrismaClient, options: AttachmentRouteOptions = {}) {
  const uploadDir = resolveUploadDir(options.uploadDir);

  app.get("/admin/backup/export", { preHandler: app.requireAdmin }, async (_request, reply) => {
    const data: Record<string, Row[]> = {};
    for (const [name] of modelSpecs) data[name] = await delegate(prisma, name).findMany();
    const attachmentContents = [];
    for (const attachment of data.issueAttachment ?? []) {
      const attachmentId = Number(attachment.id);
      const content = await readAttachmentBuffer(prisma, uploadDir, { storageType: String(attachment.storageType), storageName: String(attachment.storageName) }, options);
      attachmentContents.push({ attachmentId, contentBase64: content.toString("base64") });
    }
    const date = new Date().toISOString().slice(0, 10);
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="issueflow-backup-${date}.json"`);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(JSON.stringify({ format: "issueflow-backup", version: 1, exportedAt: new Date().toISOString(), data, attachmentContents }));
  });

  app.post("/admin/backup/import", { preHandler: app.requireAdmin }, async (request) => {
    if ((request.query as { confirm?: string }).confirm !== "OVERWRITE") throw new ApiError(400, "BACKUP_CONFIRMATION_REQUIRED", "Import confirmation is required");
    let part;
    try { part = await request.file({ limits: { files: 1, parts: 2, fileSize: MAX_BACKUP_SIZE } }); }
    catch (error) {
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new ApiError(413, "BACKUP_TOO_LARGE", "Backup file must not exceed 1 GiB");
      throw error;
    }
    if (!part || part.fieldname !== "backup") throw new ApiError(400, "BACKUP_FILE_REQUIRED", "Multipart field 'backup' is required");
    let parsed: unknown;
    try { parsed = JSON.parse((await part.toBuffer()).toString("utf8")); }
    catch { throw new ApiError(400, "INVALID_BACKUP", "Backup file is not valid JSON"); }
    const result = backupSchema.safeParse(parsed);
    if (!result.success) throw new ApiError(400, "INVALID_BACKUP", "Backup format is invalid", result.error.issues);
    const backup = result.data;
    const expectedModels = new Set(modelSpecs.map(([name]) => name));
    if (Object.keys(backup.data).length !== expectedModels.size || Object.keys(backup.data).some((name) => !expectedModels.has(name as typeof modelSpecs[number][0]))) {
      throw new ApiError(400, "INVALID_BACKUP", "Backup model set does not match this IssueFlow version");
    }
    if (!rowsFor(backup.data, "user").some((row) => row.role === "ADMIN" && row.active === true)) throw new ApiError(400, "INVALID_BACKUP", "Backup must contain an active administrator");
    if (rowsFor(backup.data, "platformSetting").length !== 1 || rowsFor(backup.data, "ossSetting").length !== 1) throw new ApiError(400, "INVALID_BACKUP", "Backup singleton settings are invalid");

    const contentById = new Map<number, Buffer>();
    for (const item of backup.attachmentContents) {
      const content = Buffer.from(item.contentBase64, "base64");
      if (content.toString("base64") !== item.contentBase64 || contentById.has(item.attachmentId)) throw new ApiError(400, "INVALID_BACKUP", "Backup attachment content is invalid or duplicated");
      contentById.set(item.attachmentId, content);
    }
    const attachmentRows = rowsFor(backup.data, "issueAttachment");
    if (contentById.size !== attachmentRows.length) throw new ApiError(400, "INVALID_BACKUP", "Backup attachment content is incomplete");
    const stagedPaths: string[] = [];
    const restoredData: Record<string, Row[]> = {};
    for (const [name, dateFields] of modelSpecs) restoredData[name] = restoredRows(rowsFor(backup.data, name), dateFields);
    try {
      await mkdir(uploadDir, { recursive: true });
      restoredData.issueAttachment = rowsFor(restoredData, "issueAttachment").map((row) => {
        const content = contentById.get(Number(row.id));
        if (!content || content.length !== Number(row.size)) throw new ApiError(400, "INVALID_BACKUP", `Attachment ${String(row.id)} size does not match its metadata`);
        const storageName = `${randomUUID()}.bin`;
        const filePath = resolveAttachmentPath(uploadDir, storageName);
        stagedPaths.push(filePath);
        return { ...row, storageType: "LOCAL", storageName };
      });
      const restoredAttachments = rowsFor(restoredData, "issueAttachment");
      const writes = await Promise.allSettled(stagedPaths.map((filePath, index) => writeFile(filePath, contentById.get(Number(restoredAttachments[index]!.id))!, { flag: "wx" })));
      const failedWrite = writes.find((write) => write.status === "rejected");
      if (failedWrite?.status === "rejected") throw failedWrite.reason;
    } catch (error) {
      await Promise.all(stagedPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
      throw error;
    }

    const oldAttachments = await prisma.issueAttachment.findMany({ select: { storageType: true, storageName: true } });
    const oldSetting = await prisma.ossSetting.findUnique({ where: { id: 1 } });
    try {
      await prisma.$transaction(async (tx) => {
        for (const [name] of [...modelSpecs].reverse()) await delegate(tx, name).deleteMany();
        await tx.$executeRawUnsafe("DELETE FROM sqlite_sequence");
        for (const [name] of modelSpecs) if (rowsFor(restoredData, name).length) await delegate(tx, name).createMany({ data: rowsFor(restoredData, name) });
      }, { maxWait: 10_000, timeout: 120_000 });
    } catch (error) {
      await Promise.all(stagedPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
      if (error instanceof Prisma.PrismaClientValidationError || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003"].includes(error.code))) {
        throw new ApiError(400, "INVALID_BACKUP", "Backup data is incompatible or violates database constraints");
      }
      throw error;
    }
    void (async () => {
      for (const attachment of oldAttachments) await deleteAttachmentContent(prisma, uploadDir, attachment, options, oldSetting).catch(() => undefined);
    })();
    return { ok: true, message: "Backup imported; all platform data was overwritten", counts: Object.fromEntries(modelSpecs.map(([name]) => [name, rowsFor(restoredData, name).length])) };
  });
}
