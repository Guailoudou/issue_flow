import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  createDesktopPairingSchema,
  desktopPairingApprovalSchema,
  desktopPairingExchangeSchema,
  desktopPairingVerifyQuerySchema,
} from "@issueflow/shared";
import { API_TOKEN_PREFIX, generateApiToken, hashCredential } from "../auth";
import { ApiError } from "../errors";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const DESKTOP_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_API_TOKENS_PER_USER = 20;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class FixedWindowLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private operationCount = 0;

  constructor(
    private readonly maxEntries = 10_000,
    private readonly now = () => Date.now(),
  ) {}

  private removeExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  private makeRoom(now: number) {
    this.removeExpired(now);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  take(key: string, limit: number, windowMs: number) {
    const now = this.now();
    this.operationCount += 1;
    if (this.operationCount % 256 === 0) this.removeExpired(now);
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.entries.size >= this.maxEntries) this.makeRoom(now);
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  get size() {
    return this.entries.size;
  }
}

const pairingIpLimiter = new FixedWindowLimiter(20_000);
const pairingIdLimiter = new FixedWindowLimiter(10_000);

function normalizedUserCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function generateUserCode() {
  const bytes = crypto.randomBytes(8);
  const raw = [...bytes].map((byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function secureHashMatches(value: string, expectedHex: string) {
  const actual = Buffer.from(hashCredential(value), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function verificationUrl(userCode: string) {
  const configured = process.env.WEB_ORIGIN || "http://localhost:5173";
  const url = new URL("/desktop/authorize", configured);
  url.searchParams.set("code", userCode);
  return url.toString();
}

function requireRateLimit(request: FastifyRequest, scope: string, limit: number, windowMs: number) {
  if (!pairingIpLimiter.take(`${scope}:${request.ip}`, limit, windowMs)) {
    throw new ApiError(429, "RATE_LIMITED", "Too many desktop authorization attempts; retry later");
  }
}

async function createPairingRecord(prisma: PrismaClient, deviceName: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID();
    const userCode = generateUserCode();
    const deviceSecret = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    try {
      await prisma.desktopPairing.create({ data: {
        id,
        deviceName,
        userCodeHash: hashCredential(normalizedUserCode(userCode)),
        deviceSecretHash: hashCredential(deviceSecret),
        expiresAt,
      } });
      return { id, userCode, deviceSecret, expiresAt };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  throw new ApiError(503, "PAIRING_UNAVAILABLE", "Could not create a desktop authorization request");
}

export async function desktopAuthRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const requireBrowserSession = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization !== undefined) throw new ApiError(401, "SESSION_REQUIRED", "Desktop authorization must be approved from a signed-in browser session");
    await app.authenticate(request, reply);
  };

  app.post("/desktop/pairings", async (request, reply) => {
    requireRateLimit(request, "pairing-create", 30, 10 * 60 * 1000);
    const { deviceName } = createDesktopPairingSchema.parse(request.body);
    await prisma.desktopPairing.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    const pairing = await createPairingRecord(prisma, deviceName);
    reply.status(201);
    return {
      pairingId: pairing.id,
      deviceSecret: pairing.deviceSecret,
      userCode: pairing.userCode,
      verificationUrl: verificationUrl(pairing.userCode),
      expiresAt: pairing.expiresAt,
      pollIntervalSeconds: 5,
    };
  });

  app.get("/desktop/pairings/verify", { preHandler: requireBrowserSession }, async (request) => {
    requireRateLimit(request, "pairing-verify", 60, 10 * 60 * 1000);
    const { code } = desktopPairingVerifyQuerySchema.parse(request.query);
    const pairing = await prisma.desktopPairing.findUnique({ where: { userCodeHash: hashCredential(normalizedUserCode(code)) } });
    if (!pairing || pairing.expiresAt <= new Date() || pairing.consumedAt) throw new ApiError(404, "PAIRING_NOT_FOUND", "Desktop authorization request was not found or has expired");
    return { pairingId: pairing.id, deviceName: pairing.deviceName, expiresAt: pairing.expiresAt, approvedAt: pairing.approvedAt, consumedAt: pairing.consumedAt };
  });

  app.post("/desktop/pairings/approve", { preHandler: requireBrowserSession }, async (request) => {
    requireRateLimit(request, "pairing-approve", 30, 10 * 60 * 1000);
    const { code } = desktopPairingApprovalSchema.parse(request.body);
    const now = new Date();
    const pairing = await prisma.desktopPairing.findUnique({ where: { userCodeHash: hashCredential(normalizedUserCode(code)) } });
    if (!pairing || pairing.expiresAt <= now || pairing.consumedAt) throw new ApiError(404, "PAIRING_NOT_FOUND", "Desktop authorization request was not found or has expired");
    if (pairing.approvedUserId !== null && pairing.approvedUserId !== request.currentUser.id) throw new ApiError(409, "PAIRING_ALREADY_APPROVED", "Desktop authorization request was already approved");
    if (pairing.approvedUserId === request.currentUser.id) {
      return { pairingId: pairing.id, status: "APPROVED" as const, approvedAt: pairing.approvedAt! };
    }

    const approvedAt = now;
    const claimed = await prisma.desktopPairing.updateMany({
      where: { id: pairing.id, approvedUserId: null, consumedAt: null, expiresAt: { gt: now } },
      data: { approvedUserId: request.currentUser.id, approvedAt },
    });
    if (!claimed.count) {
      const current = await prisma.desktopPairing.findUnique({ where: { id: pairing.id } });
      if (current?.approvedUserId === request.currentUser.id && current.approvedAt) {
        return { pairingId: current.id, status: "APPROVED" as const, approvedAt: current.approvedAt };
      }
      if (!current || current.expiresAt <= now || current.consumedAt) throw new ApiError(404, "PAIRING_NOT_FOUND", "Desktop authorization request was not found or has expired");
      throw new ApiError(409, "PAIRING_ALREADY_APPROVED", "Desktop authorization request was already approved");
    }
    return { pairingId: pairing.id, status: "APPROVED" as const, approvedAt };
  });

  app.post("/desktop/pairings/:id/exchange", async (request, reply) => {
    const { id: pairingId } = z.object({ id: z.string().uuid() }).parse(request.params);
    requireRateLimit(request, "pairing-exchange-ip", 300, 10 * 60 * 1000);
    if (!pairingIdLimiter.take(`pairing-exchange-id:${pairingId}`, 150, 10 * 60 * 1000)) throw new ApiError(429, "RATE_LIMITED", "Too many desktop authorization polling attempts");
    const { deviceSecret } = desktopPairingExchangeSchema.parse(request.body);
    const pairing = await prisma.desktopPairing.findUnique({ where: { id: pairingId } });
    if (!pairing || !secureHashMatches(deviceSecret, pairing.deviceSecretHash)) throw new ApiError(404, "PAIRING_NOT_FOUND", "Desktop authorization request was not found");
    if (pairing.expiresAt <= new Date()) throw new ApiError(410, "PAIRING_EXPIRED", "Desktop authorization request has expired");
    if (pairing.consumedAt) throw new ApiError(410, "PAIRING_CONSUMED", "Desktop authorization request was already consumed");
    if (pairing.approvedUserId === null) {
      reply.status(202);
      return { status: "PENDING" as const, expiresAt: pairing.expiresAt, retryAfterSeconds: 5 };
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.desktopPairing.findUniqueOrThrow({ where: { id: pairing.id }, include: { approvedUser: true } });
      if (current.consumedAt) throw new ApiError(410, "PAIRING_CONSUMED", "Desktop authorization request was already consumed");
      if (current.expiresAt <= new Date()) throw new ApiError(410, "PAIRING_EXPIRED", "Desktop authorization request has expired");
      if (!current.approvedUser?.active) throw new ApiError(401, "USER_INACTIVE", "The approving user is inactive");
      await tx.apiToken.deleteMany({ where: { userId: current.approvedUserId!, expiresAt: { lte: new Date() } } });
      if (await tx.apiToken.count({ where: { userId: current.approvedUserId! } }) >= MAX_API_TOKENS_PER_USER) {
        throw new ApiError(409, "API_TOKEN_LIMIT_REACHED", `Each user can keep at most ${MAX_API_TOKENS_PER_USER} API tokens`);
      }
      const consumedAt = new Date();
      const claimed = await tx.desktopPairing.updateMany({ where: { id: current.id, consumedAt: null }, data: { consumedAt } });
      if (!claimed.count) throw new ApiError(410, "PAIRING_CONSUMED", "Desktop authorization request was already consumed");
      const token = generateApiToken();
      const apiToken = await tx.apiToken.create({ data: {
        userId: current.approvedUserId!,
        name: `IssueFlow Desktop · ${current.deviceName}`,
        kind: "DESKTOP",
        deviceName: current.deviceName,
        tokenHash: hashCredential(token),
        tokenPrefix: token.slice(0, API_TOKEN_PREFIX.length + 8),
        expiresAt: new Date(consumedAt.getTime() + DESKTOP_TOKEN_TTL_MS),
      } });
      return { token, apiToken };
    });

    return {
      status: "AUTHORIZED" as const,
      token: result.token,
      apiToken: {
        id: result.apiToken.id,
        name: result.apiToken.name,
        prefix: result.apiToken.tokenPrefix,
        kind: result.apiToken.kind,
        deviceName: result.apiToken.deviceName,
        expiresAt: result.apiToken.expiresAt,
        createdAt: result.apiToken.createdAt,
      },
    };
  });
}
