import type { YunxiaoIntegration } from "@prisma/client";
import { ApiError } from "../../errors";

export type YunxiaoFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface YunxiaoClientOptions {
  fetchImpl: YunxiaoFetch;
  timeoutMs: number;
}

function repositoryPath(integration: YunxiaoIntegration) {
  const repositoryId = encodeURIComponent(integration.repositoryId);
  if (integration.edition === "CENTRAL") {
    return `/oapi/v1/codeup/organizations/${encodeURIComponent(integration.organizationId)}/repositories/${repositoryId}`;
  }
  return `/oapi/v1/codeup/repositories/${repositoryId}`;
}

async function request(integration: YunxiaoIntegration, token: string, suffix: string, init: RequestInit, options: YunxiaoClientOptions) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(`${integration.baseUrl}${repositoryPath(integration)}${suffix}`, {
      ...init,
      headers: { "content-type": "application/json", "x-yunxiao-token": token, ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new ApiError(502, "YUNXIAO_HTTP_ERROR", `Yunxiao OpenAPI returned HTTP ${response.status}`);
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text) as Record<string, unknown>; }
    catch { throw new ApiError(502, "YUNXIAO_INVALID_RESPONSE", "Yunxiao OpenAPI returned an invalid JSON response"); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ApiError(504, "YUNXIAO_TIMEOUT", `Yunxiao OpenAPI did not respond within ${options.timeoutMs}ms`);
    throw new ApiError(502, "YUNXIAO_CONNECTION_FAILED", "Could not connect to Yunxiao OpenAPI");
  } finally {
    clearTimeout(timer);
  }
}

export async function testRepository(integration: YunxiaoIntegration, token: string, options: YunxiaoClientOptions) {
  return request(integration, token, "", { method: "GET" }, options);
}

export async function createRepositoryWebhook(integration: YunxiaoIntegration, token: string, secret: string, webhookUrl: string, options: YunxiaoClientOptions) {
  return request(integration, token, "/webhooks", {
    method: "POST",
    body: JSON.stringify({
      description: "IssueFlow issue integration",
      enableSslVerification: webhookUrl.startsWith("https://"),
      mergeRequestsEvents: true,
      noteEvents: false,
      pushEvents: true,
      tagPushEvents: false,
      token: secret,
      url: webhookUrl,
    }),
  }, options);
}
