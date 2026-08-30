import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export function installErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: "Resource not found", requestId: request.id } }));
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request data", requestId: request.id, details: error.issues } });
    if (error instanceof ApiError) return reply.status(error.status).send({ error: { code: error.code, message: error.message, requestId: request.id, ...(error.details === undefined ? {} : { details: error.details }) } });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return reply.status(409).send({ error: { code: "CONFLICT", message: "A record with the same unique value already exists", requestId: request.id } });
      if (error.code === "P2003") return reply.status(409).send({ error: { code: "IN_USE", message: "This record is still in use", requestId: request.id } });
      if (error.code === "P2025") return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Resource not found", requestId: request.id } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId: request.id } });
  });
}
