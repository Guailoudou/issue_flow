import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "./errors";

export const COOKIE_NAME = "issueflow_session";
export const API_TOKEN_PREFIX = "ift_";
export const hashCredential = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const generateApiToken = () => `${API_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
const DEFAULT_SESSION_TTL_DAYS = 30;

function sessionTtlDays() {
  const configured = Number(process.env.SESSION_TTL_DAYS ?? DEFAULT_SESSION_TTL_DAYS);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : DEFAULT_SESSION_TTL_DAYS;
}

function secureCookieEnabled() {
  const configured = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(configured ?? "")) return true;
  if (["0", "false", "no", "off"].includes(configured ?? "")) return false;
  return process.env.NODE_ENV === "production";
}

export async function createSession(prisma: PrismaClient, userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlDays() * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, tokenHash: hashCredential(token), expiresAt } });
  return { token, expiresAt };
}

export async function deleteSession(prisma: PrismaClient, token?: string) {
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashCredential(token) } });
}

export function installAuth(app: FastifyInstance, prisma: PrismaClient) {
  app.decorate("authenticate", async (request) => {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      const match = authorization.match(/^Bearer\s+(\S+)$/i);
      if (!match?.[1]) throw new ApiError(401, "API_TOKEN_INVALID", "API token is invalid");
      const now = new Date();
      const apiToken = await prisma.apiToken.findUnique({ where: { tokenHash: hashCredential(match[1]) }, include: { user: true } });
      if (!apiToken) throw new ApiError(401, "API_TOKEN_INVALID", "API token is invalid");
      if (apiToken.expiresAt && apiToken.expiresAt <= now) {
        await prisma.apiToken.deleteMany({ where: { id: apiToken.id } });
        throw new ApiError(401, "API_TOKEN_EXPIRED", "API token has expired");
      }
      if (!apiToken.user.active) throw new ApiError(401, "API_TOKEN_INVALID", "API token is invalid");
      if (!apiToken.lastUsedAt || apiToken.lastUsedAt.getTime() < now.getTime() - 5 * 60 * 1000) {
        await prisma.apiToken.updateMany({ where: { id: apiToken.id }, data: { lastUsedAt: now } });
      }
      request.currentUser = apiToken.user;
      return;
    }
    const token = request.cookies[COOKIE_NAME];
    if (!token) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
    const session = await prisma.session.findUnique({ where: { tokenHash: hashCredential(token) }, include: { user: true } });
    if (!session || session.expiresAt <= new Date() || !session.user.active) {
      if (session) await prisma.session.deleteMany({ where: { id: session.id } });
      throw new ApiError(401, "SESSION_EXPIRED", "Session is invalid or expired");
    }
    request.currentUser = session.user;
  });
  app.decorate("requireAdmin", async (request, reply) => {
    await app.authenticate(request, reply);
    if (request.currentUser.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Administrator access required");
  });
}

export const cookieOptions = (expiresAt?: Date) => ({
  path: "/", httpOnly: true, sameSite: "lax" as const,
  secure: secureCookieEnabled(), ...(expiresAt ? { expires: expiresAt } : {}),
});
