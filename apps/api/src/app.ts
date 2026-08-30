import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { PrismaClient } from "@prisma/client";
import { ensureBootstrapData } from "./bootstrap";
import { installAuth } from "./auth";
import { installErrorHandler } from "./errors";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { issueRoutes } from "./routes/issues";
import { commentRoutes } from "./routes/comments";
import { notificationRoutes } from "./routes/notifications";
import { yunxiaoRoutes, type YunxiaoRouteOptions } from "./integrations/yunxiao/routes";
import { attachmentRoutes, type AttachmentRouteOptions } from "./routes/attachments";
import { exportRoutes } from "./routes/export";
import { versionRoutes } from "./routes/version";
import { apiTokenRoutes } from "./routes/apiTokens";
import type { AiOptions } from "./ai/labeler";

export async function buildApp(options: { prisma?: PrismaClient; logger?: boolean; yunxiao?: YunxiaoRouteOptions; attachments?: AttachmentRouteOptions; ai?: AiOptions } = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const prisma = options.prisma ?? new PrismaClient();
  await app.register(cookie);
  await app.register(multipart, { preservePath: true, limits: { files: 1, fileSize: 10 * 1024 * 1024, parts: 2 } });
  await app.register(cors, { origin: process.env.WEB_ORIGIN || "http://localhost:5173", credentials: true });
  installErrorHandler(app);
  installAuth(app, prisma);
  await ensureBootstrapData(prisma);
  await app.register(async (api) => {
    api.get("/health", async () => { await prisma.$queryRaw`SELECT 1`; return { status: "ok" }; });
    await versionRoutes(api);
    await authRoutes(api, prisma);
    await apiTokenRoutes(api, prisma);
    await adminRoutes(api, prisma, options.ai);
    await issueRoutes(api, prisma, options.ai);
    await attachmentRoutes(api, prisma, options.attachments);
    await exportRoutes(api, prisma, options.attachments);
    await commentRoutes(api, prisma);
    await notificationRoutes(api, prisma);
    await yunxiaoRoutes(api, prisma, options.yunxiao);
  }, { prefix: "/api" });
  if (!options.prisma) app.addHook("onClose", async () => prisma.$disconnect());
  await app.ready();
  return app;
}
