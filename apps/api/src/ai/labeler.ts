import type { Issue, PlatformSetting, PrismaClient } from "@prisma/client";
import { ApiError } from "../errors";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "../integrations/yunxiao/crypto";

export type AiOptions = { encryptionKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number };

function requireAiEncryptionKey(value: string | undefined): Buffer {
  try {
    const key = parseEncryptionKey(value);
    if (key) return key;
  } catch {
    throw new ApiError(503, "AI_ENCRYPTION_KEY_INVALID", "YUNXIAO_ENCRYPTION_KEY must be 32-byte base64 or 64 hexadecimal characters");
  }
  throw new ApiError(503, "AI_ENCRYPTION_KEY_MISSING", "YUNXIAO_ENCRYPTION_KEY is required before saving an AI API key");
}

export function encryptAiApiKey(value: string, options: AiOptions): string {
  return encryptSecret(value, requireAiEncryptionKey(options.encryptionKey ?? process.env.YUNXIAO_ENCRYPTION_KEY));
}

function decryptAiApiKey(value: string, options: AiOptions): string {
  try {
    return decryptSecret(value, requireAiEncryptionKey(options.encryptionKey ?? process.env.YUNXIAO_ENCRYPTION_KEY));
  } catch (error) {
    if (error instanceof ApiError && error.code?.startsWith("AI_")) throw error;
    throw new ApiError(503, "AI_CREDENTIAL_DECRYPTION_FAILED", "Stored AI credentials cannot be decrypted with YUNXIAO_ENCRYPTION_KEY");
  }
}

export function issueBodyForAi(body: string): string {
  const imageReferences = [...body.matchAll(/!\[[^\]]*\]\[([^\]]+)\]/g)]
    .map((match) => match[1])
    .filter((reference): reference is string => !!reference);
  let text = body;
  for (const reference of imageReferences) {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^\\s*\\[${escaped}\\]:.*$`, "gim"), "");
  }
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/data:image\/[^\s)]+/gi, "")
    .trim()
    .slice(0, 20_000);
}

function parseLabelIds(content: string, allowedIds: Set<number>, limit: number): number[] {
  const start = content.indexOf("{"); const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  const value = JSON.parse(content.slice(start, end + 1)) as { labelIds?: unknown };
  if (!Array.isArray(value.labelIds)) return [];
  return [...new Set(value.labelIds.filter((id): id is number => Number.isSafeInteger(id) && allowedIds.has(id as number)))].slice(0, limit);
}

export async function assignAiLabels(prisma: PrismaClient, issue: Pick<Issue, "id" | "title" | "body">, setting: PlatformSetting, options: AiOptions = {}): Promise<number[]> {
  if (!setting.aiEnabled || !setting.aiUrl || !setting.aiModel) return [];
  const labels = await prisma.label.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, description: true } });
  if (!labels.length) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? setting.aiTimeoutSeconds * 1_000);
  try {
    const apiKey = setting.aiApiKeyEncrypted ? decryptAiApiKey(setting.aiApiKeyEncrypted, options) : "";
    const response = await (options.fetchImpl ?? fetch)(setting.aiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: setting.aiModel,
        messages: [
          { role: "system", content: `Choose up to ${setting.aiMaxLabels} relevant labels for the issue. Only use IDs from the supplied label list. Return only a JSON object shaped as {"labelIds":[1,2]}; return an empty array when none apply.` },
          { role: "user", content: JSON.stringify({ title: issue.title, body: issueBodyForAi(issue.body), labels }) },
        ],
        ...(setting.aiStructuredOutput ? { response_format: {
          type: "json_schema",
          json_schema: {
            name: "issue_labels",
            strict: true,
            schema: {
              type: "object",
              properties: { labelIds: { type: "array", items: { type: "integer" }, maxItems: setting.aiMaxLabels } },
              required: ["labelIds"],
              additionalProperties: false,
            },
          },
        } } : {}),
        ...(setting.aiDisableThinking ? { enable_thinking: false } : {}),
        stream: false,
      }),
    });
    if (!response.ok) throw new Error(`AI labeling returned HTTP ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("AI labeling returned an invalid response");
    const labelIds = parseLabelIds(content, new Set(labels.map(({ id }) => id)), setting.aiMaxLabels);
    if (!labelIds.length) return [];
    return prisma.$transaction(async (tx) => {
      if (await tx.issueLabel.count({ where: { issueId: issue.id } })) return [];
      await tx.issueLabel.createMany({ data: labelIds.map((labelId) => ({ issueId: issue.id, labelId })) });
      return labelIds;
    });
  } finally {
    clearTimeout(timeout);
  }
}
