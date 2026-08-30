import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

const packageInfo = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

function dockerBuiltAt() {
  try { return readFileSync(new URL("../../.build-id", import.meta.url), "utf8").trim(); }
  catch { return new Date().toISOString(); }
}

const builtAt = dockerBuiltAt();
const buildId = process.env.ISSUEFLOW_API_BUILD_ID?.trim() || builtAt.replace(/\D/g, "").slice(0, 14);

export async function versionRoutes(app: FastifyInstance) {
  app.get("/version", { preHandler: app.authenticate }, async () => ({ version: packageInfo.version, buildId, builtAt }));
}
