import type { User, UserRole } from "@prisma/client";
import type { RealtimeHub } from "./realtime/hub";

type CurrentUser = User & { businessRoles: UserRole[] };

declare module "fastify" {
  interface FastifyRequest {
    currentUser: CurrentUser;
    apiTokenId?: number;
    apiTokenExpiresAt?: Date | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    realtime: RealtimeHub;
  }
}
