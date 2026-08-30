import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ossSettingSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { asOssError, createOssClient, encryptOssCredential, publicOssSetting, type OssOptions } from "../storage/oss";
import { asWebDavError, createWebDavClient, encryptWebDavCredential, type WebDavOptions } from "../storage/webdav";

export async function ossRoutes(app: FastifyInstance, prisma: PrismaClient, options: { oss?: OssOptions; webdav?: WebDavOptions } = {}) {
  app.get("/admin/storage/oss", { preHandler: app.requireAdmin }, async () => ({
    setting: publicOssSetting(await prisma.ossSetting.findUnique({ where: { id: 1 } })),
  }));

  app.put("/admin/storage/oss", { preHandler: app.requireAdmin }, async (request) => {
    const input = ossSettingSchema.parse(request.body);
    const current = await prisma.ossSetting.findUnique({ where: { id: 1 } });
    const accessKeyIdEncrypted = input.clearCredentials ? null : input.accessKeyId ? encryptOssCredential(input.accessKeyId, options.oss ?? {}) : current?.accessKeyIdEncrypted ?? null;
    const accessKeySecretEncrypted = input.clearCredentials ? null : input.accessKeySecret ? encryptOssCredential(input.accessKeySecret, options.oss ?? {}) : current?.accessKeySecretEncrypted ?? null;
    const webdavUsernameEncrypted = input.clearWebdavCredentials ? null : input.webdavUsername ? encryptWebDavCredential(input.webdavUsername, options.webdav ?? {}) : current?.webdavUsernameEncrypted ?? null;
    const webdavPasswordEncrypted = input.clearWebdavCredentials ? null : input.webdavPassword ? encryptWebDavCredential(input.webdavPassword, options.webdav ?? {}) : current?.webdavPasswordEncrypted ?? null;
    if (input.storageMode === "S3" && (!accessKeyIdEncrypted || !accessKeySecretEncrypted)) {
      throw new ApiError(400, "S3_CREDENTIALS_REQUIRED", "AccessKey ID and AccessKey Secret are required before enabling S3 storage");
    }
    if (input.storageMode === "WEBDAV" && (!webdavUsernameEncrypted || !webdavPasswordEncrypted)) {
      throw new ApiError(400, "WEBDAV_CREDENTIALS_REQUIRED", "Username and password are required before enabling WebDAV storage");
    }
    const { accessKeyId: _, accessKeySecret: __, clearCredentials: ___, webdavUsername: ____, webdavPassword: _____, clearWebdavCredentials: ______, ...data } = input;
    const stored = { ...data, enabled: input.storageMode === "S3", accessKeyIdEncrypted, accessKeySecretEncrypted, webdavUsernameEncrypted, webdavPasswordEncrypted };
    const setting = await prisma.ossSetting.upsert({
      where: { id: 1 },
      create: { id: 1, ...stored },
      update: stored,
    });
    return { setting: publicOssSetting(setting) };
  });

  app.post("/admin/storage/oss/test", { preHandler: app.requireAdmin }, async () => {
    const setting = await prisma.ossSetting.findUnique({ where: { id: 1 } });
    if (!setting) throw new ApiError(404, "S3_NOT_CONFIGURED", "S3 storage has not been configured");
    try {
      await createOssClient(setting, options.oss).getBucketInfo();
      await prisma.ossSetting.update({ where: { id: 1 }, data: { lastTestedAt: new Date(), lastTestStatus: "SUCCESS", lastTestMessage: "S3 bucket connection succeeded" } });
      return { ok: true, message: "S3 bucket connection succeeded" };
    } catch (error) {
      const mapped = asOssError(error, "connection test");
      await prisma.ossSetting.update({ where: { id: 1 }, data: { lastTestedAt: new Date(), lastTestStatus: "FAILED", lastTestMessage: mapped.message.slice(0, 500) } });
      throw mapped;
    }
  });

  app.post("/admin/storage/webdav/test", { preHandler: app.requireAdmin }, async () => {
    const setting = await prisma.ossSetting.findUnique({ where: { id: 1 } });
    if (!setting) throw new ApiError(404, "WEBDAV_NOT_CONFIGURED", "WebDAV storage has not been configured");
    try {
      await createWebDavClient(setting, options.webdav).test();
      await prisma.ossSetting.update({ where: { id: 1 }, data: { lastTestedAt: new Date(), lastTestStatus: "SUCCESS", lastTestMessage: "WebDAV connection succeeded" } });
      return { ok: true, message: "WebDAV connection succeeded" };
    } catch (error) {
      const mapped = asWebDavError(error, "connection test");
      await prisma.ossSetting.update({ where: { id: 1 }, data: { lastTestedAt: new Date(), lastTestStatus: "FAILED", lastTestMessage: mapped.message.slice(0, 500) } });
      throw mapped;
    }
  });
}
