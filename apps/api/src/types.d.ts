import type { User } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest { currentUser: User; }
  interface FastifyInstance { authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; }
}
