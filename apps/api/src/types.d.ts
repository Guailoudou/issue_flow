import type { User, UserRole } from "@prisma/client";

type CurrentUser = User & { businessRoles: UserRole[] };

declare module "fastify" {
  interface FastifyRequest { currentUser: CurrentUser; }
  interface FastifyInstance { authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; }
}
