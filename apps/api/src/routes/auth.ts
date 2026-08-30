import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { changePasswordSchema, loginSchema, registerUserSchema, updateProfileSchema } from "@issueflow/shared";
import { ApiError } from "../errors";
import { COOKIE_NAME, cookieOptions, createSession, deleteSession } from "../auth";
import { publicUser } from "../utils";

function inviteCodeMatches(provided: string) {
  const configured = process.env.REGISTRATION_INVITE_CODE?.trim();
  if (!configured) throw new ApiError(503, "REGISTRATION_DISABLED", "Account registration is not configured");
  const expectedHash = crypto.createHash("sha256").update(configured).digest();
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(expectedHash, providedHash);
}

export async function authRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    if (!user || !user.active || !(await bcrypt.compare(input.password, user.passwordHash))) throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password");
    const session = await createSession(prisma, user.id);
    reply.setCookie(COOKIE_NAME, session.token, cookieOptions(session.expiresAt));
    return { user: publicUser(user) };
  });

  app.post("/auth/register", async (request, reply) => {
    const input = registerUserSchema.parse(request.body);
    if (!inviteCodeMatches(input.inviteCode)) throw new ApiError(403, "INVALID_INVITE_CODE", "Invalid invitation code");
    const { password, inviteCode: _, ...profile } = input;
    const user = await prisma.user.create({ data: { ...profile, email: profile.email || null, passwordHash: await bcrypt.hash(password, 12) } });
    const session = await createSession(prisma, user.id);
    reply.status(201).setCookie(COOKIE_NAME, session.token, cookieOptions(session.expiresAt));
    return { user: publicUser(user) };
  });

  app.post("/auth/logout", async (request, reply) => {
    await deleteSession(prisma, request.cookies[COOKIE_NAME]);
    reply.clearCookie(COOKIE_NAME, cookieOptions());
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: app.authenticate }, async (request) => ({ user: publicUser(request.currentUser) }));

  app.patch("/auth/profile", { preHandler: app.authenticate }, async (request) => {
    const input = updateProfileSchema.parse(request.body);
    const user = await prisma.user.update({ where: { id: request.currentUser.id }, data: { displayName: input.displayName } });
    return { user: publicUser(user) };
  });

  app.post("/auth/change-password", { preHandler: app.authenticate }, async (request, reply) => {
    const input = changePasswordSchema.parse(request.body);
    if (!(await bcrypt.compare(input.currentPassword, request.currentUser.passwordHash))) {
      throw new ApiError(400, "CURRENT_PASSWORD_INVALID", "Current password is incorrect");
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: request.currentUser.id }, data: { passwordHash: await bcrypt.hash(input.newPassword, 12) } }),
      prisma.session.deleteMany({ where: { userId: request.currentUser.id } }),
      prisma.apiToken.deleteMany({ where: { userId: request.currentUser.id } }),
    ]);
    reply.clearCookie(COOKIE_NAME, cookieOptions());
    return { ok: true };
  });
}
