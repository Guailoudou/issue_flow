import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient, type YunxiaoIntegration } from "@prisma/client";
import { yunxiaoIntegrationSchema, yunxiaoTestSchema } from "@issueflow/shared";
import { ApiError } from "../../errors";
import { parseId, timelineData } from "../../utils";
import { createRepositoryWebhook, testRepository, type YunxiaoFetch } from "./client";
import { decryptSecret, encryptSecret, requireEncryptionKey, safeSecretEqual } from "./crypto";

type JsonObject = Record<string, unknown>;
type CommitActionConfig = Prisma.CommitActionGetPayload<{ include: { labels: { select: { labelId: true } } } }>;

export interface YunxiaoRouteOptions {
  encryptionKey?: string;
  fetchImpl?: YunxiaoFetch;
  timeoutMs?: number;
  webhookBaseUrl?: string;
}

const DEFAULT_CONFIG = {
  enabled: false,
  edition: "CENTRAL",
  baseUrl: "",
  organizationId: "",
  repositoryId: "",
  repositoryName: "",
  repositoryWebUrl: "",
  hasToken: false,
  hasWebhookSecret: false,
  lastTestedAt: null,
  lastTestStatus: null,
  lastTestMessage: null,
  updatedAt: null,
} as const;

function publicIntegration(integration: YunxiaoIntegration | null) {
  if (!integration) return DEFAULT_CONFIG;
  return {
    enabled: integration.enabled,
    edition: integration.edition,
    baseUrl: integration.baseUrl,
    organizationId: integration.organizationId,
    repositoryId: integration.repositoryId,
    repositoryName: integration.repositoryName,
    repositoryWebUrl: integration.repositoryWebUrl,
    hasToken: Boolean(integration.tokenEncrypted),
    hasWebhookSecret: Boolean(integration.webhookSecretEncrypted),
    lastTestedAt: integration.lastTestedAt,
    lastTestStatus: integration.lastTestStatus,
    lastTestMessage: integration.lastTestMessage,
    updatedAt: integration.updatedAt,
  };
}

function webhookUrl(baseUrl: string | undefined) {
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/api/integrations/yunxiao/webhook`;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function firstObject(...values: unknown[]) {
  for (const value of values) if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  return {};
}

function firstString(...values: unknown[]) {
  for (const value of values) if (typeof value === "string" && value) return value;
  return "";
}

function allIssueIds(text: string) {
  return [...new Set([...text.matchAll(/#(\d+)\b/g)].map((match) => Number(match[1])).filter(Number.isSafeInteger))];
}

function commitActionPattern(actions: CommitActionConfig[]) {
  if (!actions.length) return null;
  const keywords = actions.map(({ keyword }) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  return new RegExp(`#(${keywords.join("|")})(\\d+)\\b`, "gi");
}

function pushIssueActions(text: string, actions: CommitActionConfig[]) {
  const pattern = commitActionPattern(actions);
  if (!pattern) return [];
  const byKeyword = new Map(actions.map((action) => [action.keyword, action]));
  return [...text.matchAll(pattern)].flatMap((match) => {
    const action = byKeyword.get(match[1]?.toLowerCase() ?? "");
    const issueId = Number(match[2]);
    return action && Number.isSafeInteger(issueId) ? [{ issueId, action }] : [];
  });
}

function combinedPushActions(text: string, actions: CommitActionConfig[]) {
  const combined = new Map<number, { state: "OPEN" | "CLOSED" | null; labelIds: Set<number>; keywords: string[] }>();
  for (const { issueId, action } of pushIssueActions(text, actions)) {
    const current = combined.get(issueId) ?? { state: null, labelIds: new Set<number>(), keywords: [] };
    if (action.state === "OPEN" || action.state === "CLOSED") current.state = action.state;
    action.labels.forEach(({ labelId }) => current.labelIds.add(labelId));
    current.keywords.push(action.keyword);
    combined.set(issueId, current);
  }
  return combined;
}

function pushIssueIds(text: string, actions: CommitActionConfig[]) {
  return [...new Set([...allIssueIds(text), ...pushIssueActions(text, actions).map(({ issueId }) => issueId)])];
}

function closingIssueIds(text: string) {
  return [...new Set([...text.matchAll(/\b(?:fix(?:es|ed)?|close(?:s|d)?|resolve(?:s|d)?)\s*:?\s*#(\d+)\b/gi)].map((match) => Number(match[1])).filter(Number.isSafeInteger))];
}

function eventType(payload: JsonObject, header: string) {
  const raw = firstString(header, payload.eventType, payload.event_type, payload.eventName, payload.event_name, payload.objectKind, payload.object_kind).toLowerCase();
  if (raw.includes("merge") || raw.includes("change_request")) return "MERGE_REQUEST";
  if (raw.includes("push")) return "PUSH";
  throw new ApiError(400, "YUNXIAO_EVENT_UNSUPPORTED", "Only Push Hook and Merge Request Hook events are supported");
}

function deliveryKey(requestHeaders: Record<string, unknown>, type: string, payload: JsonObject) {
  const supplied = firstString(requestHeaders["x-codeup-event-uuid"], requestHeaders["x-gitlab-event-uuid"], requestHeaders["x-codeup-delivery"]);
  return supplied || crypto.createHash("sha256").update(`${type}:${JSON.stringify(payload)}`).digest("hex");
}

function repositoryWebUrl(payload: JsonObject, integration: YunxiaoIntegration) {
  const project = firstObject(payload.project, payload.repository);
  return firstString(project.web_url, project.webUrl, project.homepage, integration.repositoryWebUrl).replace(/\/+$/, "");
}

async function existingIssueIds(tx: Prisma.TransactionClient, ids: number[]) {
  if (!ids.length) return new Set<number>();
  return new Set((await tx.issue.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((issue) => issue.id));
}

async function processPush(tx: Prisma.TransactionClient, payload: JsonObject, integration: YunxiaoIntegration) {
  const ref = firstString(payload.ref, payload.branch, payload.refName).replace(/^refs\/heads\//, "");
  const commits = Array.isArray(payload.commits) ? payload.commits.map(asObject) : [];
  if (!commits.length && firstString(payload.after, payload.checkout_sha, payload.checkoutSha)) {
    commits.push({ id: firstString(payload.after, payload.checkout_sha, payload.checkoutSha), message: firstString(payload.message) });
  }
  const actions = await tx.commitAction.findMany({ include: { labels: { select: { labelId: true } } } });
  const candidateIds = [...new Set(commits.flatMap((commit) => pushIssueIds(`${firstString(commit.message, commit.title)} ${ref}`, actions)))];
  const validIds = await existingIssueIds(tx, candidateIds);
  const hasCommands = commits.some((commit) => pushIssueActions(firstString(commit.message, commit.title), actions).length > 0);
  const actor = hasCommands ? await tx.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } }) : null;
  if (hasCommands && !actor) throw new ApiError(503, "ADMIN_REQUIRED", "The integration requires an administrator account");
  let references = 0;
  let closedIssues = 0;
  let reopenedIssues = 0;
  let labeledIssues = 0;
  for (const commit of commits) {
    const sha = firstString(commit.id, commit.sha, commit.commitId);
    if (!sha) continue;
    const message = firstString(commit.message, commit.title) || sha.slice(0, 12);
    const author = firstObject(commit.author);
    const url = firstString(commit.url, commit.web_url, commit.webUrl) || (repositoryWebUrl(payload, integration) ? `${repositoryWebUrl(payload, integration)}/commit/${sha}` : "");
    for (const issueId of pushIssueIds(`${message} ${ref}`, actions).filter((id) => validIds.has(id))) {
      await tx.codeReference.upsert({
        where: { issueId_type_externalId: { issueId, type: "COMMIT", externalId: sha } },
        create: { issueId, type: "COMMIT", externalId: sha, title: message.slice(0, 500), url, status: "PUSHED", sourceBranch: ref || null, authorName: firstString(author.name, commit.author_name, commit.authorName) || null, commitSha: sha },
        update: { title: message.slice(0, 500), url, status: "PUSHED", sourceBranch: ref || null, authorName: firstString(author.name, commit.author_name, commit.authorName) || null, commitSha: sha },
      });
      references += 1;
    }
    for (const [issueId, action] of combinedPushActions(message, actions)) {
      if (!validIds.has(issueId)) continue;
      const state = action.state;
      const stateChanged = state ? await tx.issue.updateMany({ where: { id: issueId, state: { not: state } }, data: { state, closedAt: state === "CLOSED" ? new Date() : null } }) : { count: 0 };
      const configuredLabelIds = [...action.labelIds];
      const existingLabelIds = configuredLabelIds.length ? new Set((await tx.issueLabel.findMany({ where: { issueId, labelId: { in: configuredLabelIds } }, select: { labelId: true } })).map(({ labelId }) => labelId)) : new Set<number>();
      const addedLabelIds = configuredLabelIds.filter((labelId) => !existingLabelIds.has(labelId));
      if (addedLabelIds.length) {
        await tx.issueLabel.createMany({ data: addedLabelIds.map((labelId) => ({ issueId, labelId })) });
        await tx.timelineEvent.create({ data: { issueId, actorId: actor!.id, type: "LABELS_CHANGED", data: timelineData({ added: addedLabelIds, removed: [], action: action.keywords.join(","), source: "YUNXIAO" }) } });
        labeledIssues += 1;
      }
      if (stateChanged.count) {
        await tx.timelineEvent.create({ data: { issueId, actorId: actor!.id, type: state === "CLOSED" ? "ISSUE_CLOSED_BY_YUNXIAO_COMMIT" : "ISSUE_REOPENED_BY_YUNXIAO_COMMIT", data: timelineData({ commitSha: sha, title: message.slice(0, 500), url, action: action.keywords.join(","), source: "YUNXIAO" }) } });
        const subscriptions = await tx.subscription.findMany({ where: { issueId }, select: { userId: true } });
        if (subscriptions.length) await tx.notification.createMany({ data: subscriptions.map(({ userId }) => ({ userId, issueId, type: state === "CLOSED" ? "YUNXIAO_COMMIT_CLOSED" : "YUNXIAO_COMMIT_REOPENED", message: `Issue #${issueId} was ${state === "CLOSED" ? "closed" : "reopened"} by Yunxiao commit: ${message}`.slice(0, 1000) })) });
        if (state === "CLOSED") closedIssues += 1;
        else reopenedIssues += 1;
      }
    }
  }
  return { references, closedIssues, reopenedIssues, labeledIssues, commits: commits.length };
}

async function notifyExternalClose(tx: Prisma.TransactionClient, issueId: number, mrTitle: string) {
  const subscriptions = await tx.subscription.findMany({ where: { issueId }, select: { userId: true } });
  if (subscriptions.length) await tx.notification.createMany({
    data: subscriptions.map(({ userId }) => ({ userId, issueId, type: "YUNXIAO_MR_MERGED", message: `Issue #${issueId} was closed by merged Yunxiao MR: ${mrTitle}` })),
  });
}

async function processMergeRequest(tx: Prisma.TransactionClient, payload: JsonObject, integration: YunxiaoIntegration) {
  const attributes = firstObject(payload.object_attributes, payload.objectAttributes, payload.merge_request, payload.mergeRequest, payload.changeRequest, payload.data);
  const title = firstString(attributes.title, payload.title) || "Yunxiao merge request";
  const description = firstString(attributes.description, attributes.desc, payload.description);
  const sourceBranch = firstString(attributes.source_branch, attributes.sourceBranch, payload.sourceBranch);
  const targetBranch = firstString(attributes.target_branch, attributes.targetBranch, payload.targetBranch);
  const iid = firstString(attributes.iid, attributes.localId, attributes.id, payload.iid, payload.id) || String(attributes.iid ?? attributes.localId ?? attributes.id ?? payload.iid ?? payload.id ?? "");
  if (!iid) throw new ApiError(400, "YUNXIAO_PAYLOAD_INVALID", "Merge request payload does not contain an identifier");
  const state = firstString(attributes.state, attributes.status, payload.state, payload.status).toLowerCase();
  const action = firstString(attributes.action, payload.action).toLowerCase();
  const merged = attributes.merged === true || payload.merged === true || state === "merged" || action === "merge" || action === "merged";
  const normalizedStatus = merged ? "MERGED" : (state || action || "OPEN").toUpperCase();
  const text = `${title}\n${description}\n${sourceBranch}`;
  const ids = allIssueIds(text);
  const closingIds = new Set(closingIssueIds(text));
  const validIds = await existingIssueIds(tx, ids);
  const user = firstObject(payload.user, attributes.author);
  const authorName = firstString(user.name, user.username, payload.user_name, payload.userName) || null;
  const repoUrl = repositoryWebUrl(payload, integration);
  const url = firstString(attributes.url, attributes.web_url, attributes.webUrl, payload.url) || (repoUrl ? `${repoUrl}/merge_requests/${iid}` : "");
  const actor = await tx.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!actor) throw new ApiError(503, "ADMIN_REQUIRED", "The integration requires an administrator account");
  let references = 0;
  let closedIssues = 0;
  for (const issueId of ids.filter((id) => validIds.has(id))) {
    await tx.codeReference.upsert({
      where: { issueId_type_externalId: { issueId, type: "MERGE_REQUEST", externalId: iid } },
      create: { issueId, type: "MERGE_REQUEST", externalId: iid, title: title.slice(0, 500), url, status: normalizedStatus, sourceBranch: sourceBranch || null, targetBranch: targetBranch || null, authorName },
      update: { title: title.slice(0, 500), url, status: normalizedStatus, sourceBranch: sourceBranch || null, targetBranch: targetBranch || null, authorName },
    });
    references += 1;
    if (merged && closingIds.has(issueId)) {
      const changed = await tx.issue.updateMany({ where: { id: issueId, state: { not: "CLOSED" } }, data: { state: "CLOSED", closedAt: new Date() } });
      if (changed.count) {
        await tx.timelineEvent.create({ data: { issueId, actorId: actor.id, type: "ISSUE_CLOSED_BY_YUNXIAO_MR", data: timelineData({ mergeRequestId: iid, title, url, source: "YUNXIAO" }) } });
        await notifyExternalClose(tx, issueId, title);
        closedIssues += 1;
      }
    }
  }
  return { references, closedIssues, mergeRequestId: iid };
}

async function acquireDelivery(prisma: PrismaClient, key: string, type: string) {
  try {
    const delivery = await prisma.webhookDelivery.create({ data: { deliveryKey: key, eventType: type } });
    return { delivery, duplicate: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.webhookDelivery.findUniqueOrThrow({ where: { deliveryKey: key } });
    if (existing.status !== "FAILED") return { delivery: existing, duplicate: true };
    const retried = await prisma.webhookDelivery.updateMany({ where: { id: existing.id, status: "FAILED" }, data: { status: "PROCESSING", error: null } });
    if (!retried.count) return { delivery: existing, duplicate: true };
    return { delivery: { ...existing, status: "PROCESSING" }, duplicate: false };
  }
}

export async function yunxiaoRoutes(app: FastifyInstance, prisma: PrismaClient, options: YunxiaoRouteOptions = {}) {
  const encryptionKeyValue = options.encryptionKey ?? process.env.YUNXIAO_ENCRYPTION_KEY;
  const fetchOptions = { fetchImpl: options.fetchImpl ?? globalThis.fetch, timeoutMs: options.timeoutMs ?? 8000 };
  const publicWebhookUrl = webhookUrl(options.webhookBaseUrl ?? process.env.YUNXIAO_WEBHOOK_BASE_URL);

  app.get("/admin/integrations/yunxiao", { preHandler: app.requireAdmin }, async () => {
    const integration = await prisma.yunxiaoIntegration.findUnique({ where: { id: 1 } });
    return { integration: publicIntegration(integration), webhook: { url: publicWebhookUrl, events: ["Push Hook", "Merge Request Hook"] } };
  });

  app.put("/admin/integrations/yunxiao", { preHandler: app.requireAdmin }, async (request) => {
    const input = yunxiaoIntegrationSchema.parse(request.body);
    const current = await prisma.yunxiaoIntegration.findUnique({ where: { id: 1 } });
    const key = input.token !== undefined || input.webhookSecret !== undefined ? requireEncryptionKey(encryptionKeyValue) : null;
    const tokenEncrypted = input.token !== undefined ? encryptSecret(input.token, key!) : current?.tokenEncrypted ?? null;
    const webhookSecretEncrypted = input.webhookSecret !== undefined ? encryptSecret(input.webhookSecret, key!) : current?.webhookSecretEncrypted ?? null;
    if (input.enabled && (!tokenEncrypted || !webhookSecretEncrypted)) throw new ApiError(400, "YUNXIAO_CREDENTIALS_REQUIRED", "Token and webhook secret are required before enabling the integration");
    const { token: _, webhookSecret: __, ...data } = input;
    const integration = await prisma.yunxiaoIntegration.upsert({
      where: { id: 1 },
      create: { id: 1, ...data, tokenEncrypted, webhookSecretEncrypted },
      update: { ...data, tokenEncrypted, webhookSecretEncrypted },
    });
    return { integration: publicIntegration(integration), webhook: { url: publicWebhookUrl, events: ["Push Hook", "Merge Request Hook"] } };
  });

  app.post("/admin/integrations/yunxiao/test", { preHandler: app.requireAdmin }, async (request) => {
    const input = yunxiaoTestSchema.parse(request.body ?? {});
    const integration = await prisma.yunxiaoIntegration.findUnique({ where: { id: 1 } });
    if (!integration) throw new ApiError(404, "YUNXIAO_NOT_CONFIGURED", "Yunxiao integration has not been configured");
    const key = requireEncryptionKey(encryptionKeyValue);
    const token = input.token ?? (integration.tokenEncrypted ? decryptSecret(integration.tokenEncrypted, key) : "");
    if (!token) throw new ApiError(400, "YUNXIAO_TOKEN_REQUIRED", "A Yunxiao personal access token is required");
    try {
      await testRepository(integration, token, fetchOptions);
      await prisma.yunxiaoIntegration.update({ where: { id: 1 }, data: { lastTestedAt: new Date(), lastTestStatus: "SUCCESS", lastTestMessage: "Repository connection succeeded" } });
      return { ok: true, message: "Repository connection succeeded" };
    } catch (error) {
      await prisma.yunxiaoIntegration.update({ where: { id: 1 }, data: { lastTestedAt: new Date(), lastTestStatus: "FAILED", lastTestMessage: error instanceof Error ? error.message.slice(0, 500) : "Connection failed" } });
      throw error;
    }
  });

  app.post("/admin/integrations/yunxiao/create-webhook", { preHandler: app.requireAdmin }, async () => {
    const integration = await prisma.yunxiaoIntegration.findUnique({ where: { id: 1 } });
    if (!integration) throw new ApiError(404, "YUNXIAO_NOT_CONFIGURED", "Yunxiao integration has not been configured");
    if (!publicWebhookUrl) throw new ApiError(503, "YUNXIAO_WEBHOOK_URL_MISSING", "YUNXIAO_WEBHOOK_BASE_URL is required to create a webhook");
    const key = requireEncryptionKey(encryptionKeyValue);
    if (!integration.tokenEncrypted || !integration.webhookSecretEncrypted) throw new ApiError(400, "YUNXIAO_CREDENTIALS_REQUIRED", "Token and webhook secret are required");
    const result = await createRepositoryWebhook(integration, decryptSecret(integration.tokenEncrypted, key), decryptSecret(integration.webhookSecretEncrypted, key), publicWebhookUrl, fetchOptions);
    const nested = asObject(result.result);
    const webhookId = result.id ?? result.hookId ?? nested.id ?? nested.hookId;
    return { ok: true, message: "Webhook created", ...(webhookId === undefined ? {} : { webhookId }) };
  });

  app.post("/integrations/yunxiao/webhook", async (request, reply) => {
    const integration = await prisma.yunxiaoIntegration.findUnique({ where: { id: 1 } });
    if (!integration?.enabled || !integration.webhookSecretEncrypted) throw new ApiError(503, "YUNXIAO_INTEGRATION_DISABLED", "Yunxiao integration is not enabled");
    const key = requireEncryptionKey(encryptionKeyValue);
    const providedSecret = firstString(request.headers["x-codeup-token"]);
    if (!providedSecret || !safeSecretEqual(decryptSecret(integration.webhookSecretEncrypted, key), providedSecret)) throw new ApiError(401, "YUNXIAO_WEBHOOK_UNAUTHORIZED", "Invalid webhook token");
    const payload = asObject(request.body);
    const type = eventType(payload, firstString(request.headers["x-codeup-event"], request.headers["x-gitlab-event"]));
    const keyValue = deliveryKey(request.headers, type, payload);
    const acquired = await acquireDelivery(prisma, keyValue, type);
    reply.status(202);
    if (acquired.duplicate) return { accepted: true, duplicate: true };
    try {
      const summary = await prisma.$transaction(async (tx) => type === "PUSH" ? processPush(tx, payload, integration) : processMergeRequest(tx, payload, integration));
      await prisma.webhookDelivery.update({ where: { id: acquired.delivery.id }, data: { status: "PROCESSED", processedAt: new Date(), summary: JSON.stringify(summary), error: null } });
      return { accepted: true, duplicate: false };
    } catch (error) {
      await prisma.webhookDelivery.update({ where: { id: acquired.delivery.id }, data: { status: "FAILED", processedAt: new Date(), error: error instanceof Error ? error.message.slice(0, 500) : "Processing failed" } });
      throw error;
    }
  });

  app.get("/issues/:id/code-references", { preHandler: app.authenticate }, async (request) => {
    const issueId = parseId((request.params as { id: string }).id);
    if (!await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true } })) throw new ApiError(404, "ISSUE_NOT_FOUND", "Issue not found");
    return { references: await prisma.codeReference.findMany({ where: { issueId }, orderBy: [{ type: "asc" }, { updatedAt: "desc" }] }) };
  });
}
