import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors";

export async function realtimeRoutes(app: FastifyInstance) {
  app.get("/realtime", { websocket: true, preValidation: async (request, reply) => {
    if (!request.headers.authorization?.match(/^Bearer\s+\S+$/i)) throw new ApiError(401, "API_TOKEN_REQUIRED", "Realtime connections require a Bearer token");
    await app.authenticate(request, reply);
  } }, (socket, request) => {
    if (request.apiTokenId === undefined) {
      socket.close(1008, "API token required");
      return;
    }
    if (!app.realtime.attach(request.currentUser.id, request.apiTokenId, socket, request.apiTokenExpiresAt)) return;
    socket.on("message", () => {
      socket.close(1008, "Realtime connection is server-push only");
    });
  });
}
