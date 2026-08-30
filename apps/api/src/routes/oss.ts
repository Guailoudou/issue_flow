import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ossSettingSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { asOssError, createOssClient, encryptOssCredential, publicOssSetting, type OssOptions } from "../storage/oss";

export async function ossRoutes(app: FastifyInstance, prisma: PrismaClient, options: OssOptions = {}) {
  app.get("/admin/storage/oss", { preHandler: app.requireAdmin }, async () => ({
    setting: publicOssSetting(await prisma.ossSetting.findUnique({ where: { id: 1 } })),
  }));

  app.put("/admin/storage/oss", { preHandler: app.requireAdmin }, async (request) => {
    const input = ossSettingSchema.parse(request.body);
    const current = await prisma.ossSetting.findUnique({ where: { id: 1 } });
    const accessKeyIdEncrypted = input.accessKeyId ? encryptOssCredential(input.accessKeyId, options) : current?.accessKeyIdEncrypted ?? null;
    const accessKeySecretEncrypted = input.accessKeySecret ? encryptOssCredential(input.accessKeySecret, options) : current?.accessKeySecretEncrypted ?? null;
    if (input.enabled && (!accessKeyIdEncrypted || !accessKeySecretEncrypted)) {
      throw new ApiError(400, "S3_CREDENTIALS_REQUIRED", "AccessKey ID and AccessKey Secret are required before enabling S3 storage");
    }
    const { accessKeyId: _, accessKeySecret: __, ...data } = input;
    const setting = await prisma.ossSetting.upsert({
      where: { id: 1 },
      create: { id: 1, ...data, accessKeyIdEncrypted, accessKeySecretEncrypted },
      update: { ...data, accessKeyIdEncrypted, accessKeySecretEncrypted },
    });
    return { setting: publicOssSetting(setting) };
  });

  app.post("/admin/storage/oss/test", { preHandler: app.requireAdmin }, async () => {
    const setting = await prisma.ossSetting.findUnique({ where: { id: 1 } });
    if (!setting) throw new ApiError(404, "S3_NOT_CONFIGURED", "S3 storage has not been configured");
    try {
      await createOssClient(setting, options).getBucketInfo();
      await prisma.ossSetting.update({ where: { id: 1 }, data: { lastTestedAt: new Date(), lastTestStatus: "SUCCESS", lastTestMessage: "S3 bucket connection succeeded" } });
      return { ok: true, message: "S3 bucket connection succeeded" };
    } catch (error) {
      const mapped = asOssError(error, "connection test");
      await prisma.ossSetting.update({ where: { id: 1 }, data: { lastTestedAt: new Date(), lastTestStatus: "FAILED", lastTestMessage: mapped.message.slice(0, 500) } });
      throw mapped;
    }
  });
}
