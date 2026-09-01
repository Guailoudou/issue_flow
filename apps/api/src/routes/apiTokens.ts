import type { FastifyInstance } from "fastify";
import type { ApiToken, PrismaClient } from "@prisma/client";
import { createApiTokenSchema } from "@issueflow/shared";
import { API_TOKEN_PREFIX, generateApiToken, hashCredential } from "../auth";
import { ApiError } from "../errors";
import { parseId } from "../utils";

const MAX_API_TOKENS_PER_USER = 20;

function publicApiToken(token: Pick<ApiToken, "id" | "name" | "tokenPrefix" | "kind" | "deviceName" | "expiresAt" | "lastUsedAt" | "createdAt">) {
  return { id: token.id, name: token.name, prefix: token.tokenPrefix, kind: token.kind, deviceName: token.deviceName, expiresAt: token.expiresAt, lastUsedAt: token.lastUsedAt, createdAt: token.createdAt };
}

export async function apiTokenRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/auth/api-tokens", { preHandler: app.authenticate }, async (request) => {
    await prisma.apiToken.deleteMany({ where: { userId: request.currentUser.id, expiresAt: { lte: new Date() } } });
    const tokens = await prisma.apiToken.findMany({ where: { userId: request.currentUser.id }, orderBy: { createdAt: "desc" } });
    return { tokens: tokens.map(publicApiToken) };
  });

  app.post("/auth/api-tokens", { preHandler: app.authenticate }, async (request, reply) => {
    const input = createApiTokenSchema.parse(request.body);
    const now = new Date();
    await prisma.apiToken.deleteMany({ where: { userId: request.currentUser.id, expiresAt: { lte: now } } });
    if (await prisma.apiToken.count({ where: { userId: request.currentUser.id } }) >= MAX_API_TOKENS_PER_USER) {
      throw new ApiError(409, "API_TOKEN_LIMIT_REACHED", `Each user can keep at most ${MAX_API_TOKENS_PER_USER} API tokens`);
    }
    const token = generateApiToken();
    const expiresAt = input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const created = await prisma.apiToken.create({ data: {
      userId: request.currentUser.id,
      name: input.name,
      tokenHash: hashCredential(token),
      tokenPrefix: token.slice(0, API_TOKEN_PREFIX.length + 8),
      expiresAt,
    } });
    reply.status(201);
    return { token, apiToken: publicApiToken(created) };
  });

  app.delete("/auth/api-tokens/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    const deleted = await prisma.apiToken.deleteMany({ where: { id, userId: request.currentUser.id } });
    if (!deleted.count) throw new ApiError(404, "API_TOKEN_NOT_FOUND", "API token not found");
    app.realtime.disconnectToken(id);
    return reply.status(204).send();
  });
}
