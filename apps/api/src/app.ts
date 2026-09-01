import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
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
import { ossRoutes } from "./routes/oss";
import { backupRoutes } from "./routes/backup";
import { realtimeRoutes } from "./routes/realtime";
import { RealtimeHub } from "./realtime/hub";
import { desktopAuthRoutes } from "./routes/desktopAuth";
import { desktopRoutes } from "./routes/desktop";

function configuredTrustProxyHops() {
  const value = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0;
}

export async function buildApp(options: { prisma?: PrismaClient; logger?: boolean; trustProxyHops?: number; yunxiao?: YunxiaoRouteOptions; attachments?: AttachmentRouteOptions; ai?: AiOptions } = {}) {
  const trustProxyHops = options.trustProxyHops ?? configuredTrustProxyHops();
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: trustProxyHops > 0 ? (_address: string, hop: number) => hop < trustProxyHops : false,
  });
  const prisma = options.prisma ?? new PrismaClient();
  const realtime = new RealtimeHub();
  app.decorate("realtime", realtime);
  await app.register(websocket, { options: { maxPayload: 64 * 1024, perMessageDeflate: false } });
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
    await desktopAuthRoutes(api, prisma);
    await desktopRoutes(api, prisma);
    await adminRoutes(api, prisma, options.ai);
    await ossRoutes(api, prisma, { ...(options.attachments?.oss ? { oss: options.attachments.oss } : {}), ...(options.attachments?.webdav ? { webdav: options.attachments.webdav } : {}) });
    await backupRoutes(api, prisma, options.attachments);
    await issueRoutes(api, prisma, options.ai);
    await attachmentRoutes(api, prisma, options.attachments);
    await exportRoutes(api, prisma, options.attachments);
    await commentRoutes(api, prisma);
    await notificationRoutes(api, prisma);
    await realtimeRoutes(api);
    await yunxiaoRoutes(api, prisma, options.yunxiao);
  }, { prefix: "/api" });
  app.addHook("onClose", async () => {
    realtime.close();
    if (!options.prisma) await prisma.$disconnect();
  });
  await app.ready();
  return app;
}
