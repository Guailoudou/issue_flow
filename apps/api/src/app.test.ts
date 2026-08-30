import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { buildApp } from "./app";

const prisma = new PrismaClient();
let app: Awaited<ReturnType<typeof buildApp>>;
let adminCookie = "";
let userACookie = "";
let userBCookie = "";
let userBApiToken = "";
let userAId = 0;
let userBId = 0;
let issueId = 0;
let attachmentId = 0;
let uploadDir = "";
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const aiFetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let aiFetchGate: Promise<void> | null = null;
const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
  fetchCalls.push({ url: String(input), ...(init ? { init } : {}) });
  return new Response(JSON.stringify({ id: 88, name: "repo" }), { status: 200, headers: { "content-type": "application/json" } });
};
const mockAiFetch = async (input: string | URL | Request, init?: RequestInit) => {
  aiFetchCalls.push({ url: String(input), ...(init ? { init } : {}) });
  if (aiFetchGate) await aiFetchGate;
  const request = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
  const prompt = JSON.parse(request.messages.find(({ role }) => role === "user")?.content ?? "{}") as { labels?: Array<{ id: number }> };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ labelIds: prompt.labels?.[0] ? [prompt.labels[0].id] : [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
};

const cookieFrom = (headers: Record<string, unknown>) => String(headers["set-cookie"]).split(";")[0] ?? "";
const json = <T>(response: { json(): unknown }) => response.json() as T;
const multipartImage = (contents: Buffer, mimeType: string, fileName = "image.png") => {
  const boundary = `issueflow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      contents,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
};

beforeAll(async () => {
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "admin-password";
  process.env.SESSION_TTL_DAYS = "14";
  process.env.COOKIE_SECURE = "false";
  process.env.REGISTRATION_INVITE_CODE = "test-invite-code";
  uploadDir = await mkdtemp(path.join(tmpdir(), "issueflow-attachments-test-"));
  await prisma.issueAttachment.deleteMany();
  await prisma.webhookDelivery.deleteMany();
  await prisma.codeReference.deleteMany();
  await prisma.yunxiaoIntegration.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.timelineEvent.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.issueAssignee.deleteMany();
  await prisma.issueLabel.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.label.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.platformSetting.deleteMany();
  app = await buildApp({ prisma, attachments: { uploadDir }, yunxiao: { encryptionKey: "11".repeat(32), webhookBaseUrl: "https://issues.example.com", fetchImpl: mockFetch, timeoutMs: 100 }, ai: { encryptionKey: "22".repeat(32), fetchImpl: mockAiFetch, timeoutMs: 100 } });
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); if (uploadDir) await rm(uploadDir, { recursive: true, force: true }); });

describe.sequential("IssueFlow API", () => {
  it("bootstraps exactly one admin and rejects anonymous access", async () => {
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
    const publicSettings = await app.inject({ method: "GET", url: "/api/settings" });
    expect(publicSettings.statusCode).toBe(200);
    const denied = await app.inject({ method: "GET", url: "/api/issues" });
    expect(denied.statusCode).toBe(401);
    expect(json<{ error: { code: string } }>(denied).error.code).toBe("UNAUTHENTICATED");
  });

  it("logs in through an HttpOnly cookie", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "admin-password" } });
    expect(response.statusCode).toBe(200);
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");
    const expires = new Date(setCookie.match(/Expires=([^;]+)/)?.[1] ?? "");
    expect(expires.getTime() - Date.now()).toBeGreaterThan(13.9 * 24 * 60 * 60 * 1000);
    expect(expires.getTime() - Date.now()).toBeLessThan(14.1 * 24 * 60 * 60 * 1000);
    adminCookie = cookieFrom(response.headers);

    process.env.COOKIE_SECURE = "true";
    const secureResponse = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "admin-password" } });
    expect(String(secureResponse.headers["set-cookie"])).toContain("Secure");
    process.env.COOKIE_SECURE = "false";
  });

  it("creates hashed API tokens, authenticates Bearer requests and revokes tokens", async () => {
    const created = await app.inject({ method: "POST", url: "/api/auth/api-tokens", headers: { cookie: adminCookie }, payload: { name: "Admin automation", expiresInDays: 30 } });
    expect(created.statusCode).toBe(201);
    const result = json<{ token: string; apiToken: { id: number; name: string; prefix: string; expiresAt: string } }>(created);
    expect(result.token).toMatch(/^ift_[A-Za-z0-9_-]{43}$/);
    expect(result.apiToken).toMatchObject({ name: "Admin automation", prefix: result.token.slice(0, 12) });
    expect(Date.parse(result.apiToken.expiresAt)).toBeGreaterThan(Date.now());
    const stored = await prisma.apiToken.findUniqueOrThrow({ where: { id: result.apiToken.id } });
    expect(stored.tokenHash).not.toContain(result.token);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const bearer = { authorization: `Bearer ${result.token}` };
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/admin/stats", headers: bearer })).statusCode).toBe(200);
    const listed = await app.inject({ method: "GET", url: "/api/auth/api-tokens", headers: bearer });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(result.token);
    expect(listed.body).not.toContain("tokenHash");
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id: result.apiToken.id } })).lastUsedAt).not.toBeNull();

    const confused = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: adminCookie, authorization: "Bearer invalid" } });
    expect(confused.statusCode).toBe(401);
    expect(json<{ error: { code: string } }>(confused).error.code).toBe("API_TOKEN_INVALID");
    expect((await app.inject({ method: "DELETE", url: `/api/auth/api-tokens/${result.apiToken.id}`, headers: { cookie: adminCookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer })).statusCode).toBe(401);

    const expiring = await app.inject({ method: "POST", url: "/api/auth/api-tokens", headers: { cookie: adminCookie }, payload: { name: "Expired token", expiresInDays: 30 } });
    const expiredResult = json<{ token: string; apiToken: { id: number } }>(expiring);
    await prisma.apiToken.update({ where: { id: expiredResult.apiToken.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${expiredResult.token}` } });
    expect(expired.statusCode).toBe(401);
    expect(json<{ error: { code: string } }>(expired).error.code).toBe("API_TOKEN_EXPIRED");
    expect(await prisma.apiToken.findUnique({ where: { id: expiredResult.apiToken.id } })).toBeNull();
  });

  it("updates a personal display name and securely changes the password", async () => {
    const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: adminCookie }, payload: { username: "profile-user", password: "profile-password", displayName: "Profile User", email: "" } });
    expect(created.statusCode).toBe(201);
    const userId = json<{ user: { id: number } }>(created).user.id;
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "profile-user", password: "profile-password" } });
    const cookie = cookieFrom(login.headers);
    const tokenResponse = await app.inject({ method: "POST", url: "/api/auth/api-tokens", headers: { cookie }, payload: { name: "Profile token", expiresInDays: 30 } });
    const token = json<{ token: string }>(tokenResponse).token;

    const profile = await app.inject({ method: "PATCH", url: "/api/auth/profile", headers: { cookie }, payload: { displayName: "  Updated Profile  " } });
    expect(profile.statusCode).toBe(200);
    expect(json<{ user: { displayName: string; username: string } }>(profile).user).toMatchObject({ displayName: "Updated Profile", username: "profile-user" });
    const wrong = await app.inject({ method: "POST", url: "/api/auth/change-password", headers: { cookie }, payload: { currentPassword: "wrong-password", newPassword: "new-profile-password" } });
    expect(wrong.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(wrong).error.code).toBe("CURRENT_PASSWORD_INVALID");

    const changed = await app.inject({ method: "POST", url: "/api/auth/change-password", headers: { cookie }, payload: { currentPassword: "profile-password", newPassword: "new-profile-password" } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "profile-user", password: "profile-password" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "profile-user", password: "new-profile-password" } })).statusCode).toBe(200);

    const renamed = await app.inject({ method: "PATCH", url: `/api/admin/users/${userId}`, headers: { cookie: adminCookie }, payload: { username: "profile-renamed" } });
    expect(renamed.statusCode).toBe(200);
    expect(json<{ user: { username: string } }>(renamed).user.username).toBe("profile-renamed");
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "profile-user", password: "new-profile-password" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "profile-renamed", password: "new-profile-password" } })).statusCode).toBe(200);
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const selfRename = await app.inject({ method: "PATCH", url: `/api/admin/users/${admin.id}`, headers: { cookie: adminCookie }, payload: { username: "renamed-admin" } });
    expect(selfRename.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(selfRename).error.code).toBe("ADMIN_SELF_RENAME_FORBIDDEN");
  });

  it("registers a normal user only with the configured invitation code and starts a session", async () => {
    delete process.env.REGISTRATION_INVITE_CODE;
    const disabled = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "disabled-registration", password: "registered-password", displayName: "Disabled Registration", inviteCode: "test-invite-code" } });
    expect(disabled.statusCode).toBe(503);
    process.env.REGISTRATION_INVITE_CODE = "test-invite-code";

    const rejected = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "registered", password: "registered-password", displayName: "Registered User", email: "registered@example.com", inviteCode: "wrong-code" } });
    expect(rejected.statusCode).toBe(403);
    expect(await prisma.user.count({ where: { username: "registered" } })).toBe(0);

    const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "registered", password: "registered-password", displayName: "Registered User", email: "registered@example.com", inviteCode: "test-invite-code" } });
    expect(response.statusCode).toBe(201);
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
    expect(json<{ user: { username: string; role: string; active: boolean } }>(response).user).toMatchObject({ username: "registered", role: "USER", active: true });
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: cookieFrom(response.headers) } })).statusCode).toBe(200);

    const duplicate = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "registered", password: "registered-password", displayName: "Registered Again", inviteCode: "test-invite-code" } });
    expect(duplicate.statusCode).toBe(409);
  });

  it("returns the authenticated backend version and build identity", async () => {
    expect((await app.inject({ method: "GET", url: "/api/version" })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/version", headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(200);
    expect(json<{ version: string }>(response).version).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
    expect(json<{ buildId: string }>(response).buildId).toMatch(/^\d{14}$/);
    expect(Number.isNaN(Date.parse(json<{ builtAt: string }>(response).builtAt))).toBe(false);
  });

  it("lets the admin create multiple users", async () => {
    for (const username of ["alice", "bob"] as const) {
      const response = await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: adminCookie }, payload: { username, password: "user-password", displayName: username.toUpperCase(), email: `${username}@example.com` } });
      expect(response.statusCode).toBe(201);
      const id = json<{ user: { id: number } }>(response).user.id;
      if (username === "alice") userAId = id;
      if (username === "bob") userBId = id;
    }
    const login = async (username: string) => cookieFrom((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "user-password" } })).headers);
    userACookie = await login("alice"); userBCookie = await login("bob");
  });

  it("enforces multi-role permissions and role-specific issue owners", async () => {
    const users = await app.inject({ method: "GET", url: "/api/users", headers: { cookie: adminCookie } });
    expect(json<{ items: Array<{ username: string; roles: string[] }> }>(users).items.find(({ username }) => username === "alice")?.roles).toEqual(["DEVELOPMENT"]);

    const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: adminCookie }, payload: { username: "product-manager", password: "manager-password", displayName: "Product Manager" } });
    const managerId = json<{ user: { id: number } }>(created).user.id;
    const changed = await app.inject({ method: "PUT", url: `/api/admin/users/${managerId}/roles`, headers: { cookie: adminCookie }, payload: { roles: ["MANAGEMENT", "PRODUCT"] } });
    expect(json<{ user: { roles: string[] } }>(changed).user.roles.sort()).toEqual(["MANAGEMENT", "PRODUCT"]);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "product-manager", password: "manager-password" } });
    const managerCookie = cookieFrom(login.headers);

    expect((await app.inject({ method: "GET", url: "/api/admin/stats", headers: { cookie: managerCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: `/api/admin/users/${userBId}/roles`, headers: { cookie: managerCookie }, payload: { roles: ["PRODUCT"] } })).statusCode).toBe(403);
    const issue = await app.inject({ method: "POST", url: "/api/issues", headers: { cookie: managerCookie }, payload: { title: "Product request", productOwnerIds: [managerId], developerOwnerIds: [userBId] } });
    expect(issue.statusCode).toBe(201);
    expect(json<{ isProductIssue: boolean; assignees: Array<{ ownerType: string; userId: number }> }>(issue)).toMatchObject({ isProductIssue: true, assignees: expect.arrayContaining([expect.objectContaining({ ownerType: "PRODUCT", userId: managerId }), expect.objectContaining({ ownerType: "DEVELOPMENT", userId: userBId })]) });
    expect((await app.inject({ method: "POST", url: "/api/issues", headers: { cookie: managerCookie }, payload: { title: "Invalid owner", productOwnerIds: [userBId] } })).statusCode).toBe(400);
  });

  it("gives API tokens the same permissions as their normal user account", async () => {
    const created = await app.inject({ method: "POST", url: "/api/auth/api-tokens", headers: { cookie: userACookie }, payload: { name: "Alice script", expiresInDays: null } });
    expect(created.statusCode).toBe(201);
    const result = json<{ token: string; apiToken: { id: number; expiresAt: null } }>(created);
    expect(result.apiToken.expiresAt).toBeNull();
    const bearer = { authorization: `Bearer ${result.token}` };
    expect(json<{ user: { id: number } }>(await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer })).user.id).toBe(userAId);
    expect((await app.inject({ method: "GET", url: "/api/admin/stats", headers: bearer })).statusCode).toBe(403);
    const issue = await app.inject({ method: "POST", url: "/api/issues", headers: bearer, payload: { title: "Created through API token" } });
    expect(issue.statusCode).toBe(201);
    expect(json<{ author: { id: number } }>(issue).author.id).toBe(userAId);
    expect((await app.inject({ method: "DELETE", url: `/api/auth/api-tokens/${result.apiToken.id}`, headers: bearer })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer })).statusCode).toBe(401);

    const bobToken = await app.inject({ method: "POST", url: "/api/auth/api-tokens", headers: { cookie: userBCookie }, payload: { name: "Bob script", expiresInDays: 90 } });
    userBApiToken = json<{ token: string }>(bobToken).token;
  });

  it("creates an assigned issue with timeline, subscription and notification", async () => {
    const label = await app.inject({ method: "POST", url: "/api/admin/labels", headers: { cookie: adminCookie }, payload: { name: "bug", description: "Bug", color: "d73a4a" } });
    const labelId = json<{ id: number }>(label).id;
    const urgentLabel = await app.inject({ method: "POST", url: "/api/admin/labels", headers: { cookie: adminCookie }, payload: { name: "urgent", description: "Urgent", color: "b60205" } });
    const urgentLabelId = json<{ id: number }>(urgentLabel).id;
    const response = await app.inject({ method: "POST", url: "/api/issues", headers: { cookie: userACookie }, payload: { title: "Broken flow", body: "Please fix", assigneeIds: [userBId], labelIds: [labelId, urgentLabelId] } });
    expect(response.statusCode).toBe(201);
    issueId = json<{ id: number }>(response).id;
    expect(await prisma.timelineEvent.count({ where: { issueId, type: "ISSUE_CREATED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { issueId, userId: userBId, readAt: null } })).toBe(1);
    expect(json<{ pagination: { total: number } }>(await app.inject({ method: "GET", url: `/api/issues?labelIds=${labelId},${urgentLabelId}`, headers: { cookie: userACookie } })).pagination.total).toBe(1);
    expect(json<{ items: Array<{ id: number; issueCount: number }> }>(await app.inject({ method: "GET", url: "/api/labels", headers: { cookie: userACookie } })).items.find(({ id }) => id === labelId)?.issueCount).toBe(1);
  });

  it("queues an OpenAI-compatible request without blocking issue creation or sending images", async () => {
    aiFetchCalls.length = 0;
    const saved = await app.inject({ method: "PUT", url: "/api/admin/settings", headers: { cookie: adminCookie }, payload: {
      name: "IssueFlow", description: "", logoUrl: "", defaultPageSize: 20, allowUserCreateIssue: true,
      aiEnabled: true, aiUrl: "https://ai.example.com/v1/chat/completions", aiModel: "test-model", aiApiKey: "private-ai-key", clearAiApiKey: false, aiMaxLabels: 2,
    } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("private-ai-key");
    expect(json<{ hasAiApiKey: boolean }>(saved).hasAiApiKey).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/settings" })).body).not.toContain("aiApiKey");

    let releaseAiFetch = () => {};
    aiFetchGate = new Promise<void>((resolve) => { releaseAiFetch = resolve; });
    const response = await app.inject({ method: "POST", url: "/api/issues", headers: { cookie: userACookie }, payload: { title: "AI label request", body: "Visible description\n![secret](https://files.example.com/private.png)\n<img src=\"https://files.example.com/other.png\">\n![reference][shot]\n[shot]: https://files.example.com/reference.png" } });
    expect(response.statusCode).toBe(201);
    expect(json<{ labels: unknown[] }>(response).labels).toEqual([]);
    await vi.waitFor(() => expect(aiFetchCalls).toHaveLength(1));
    const aiCall = aiFetchCalls[0]!;
    const aiRequest = JSON.parse(String(aiCall.init?.body)) as { model: string; response_format: { type: string }; messages: Array<{ role: string; content: string }> };
    expect(aiRequest).toMatchObject({ model: "test-model", response_format: { type: "json_object" } });
    expect(aiCall.init?.headers).toMatchObject({ authorization: "Bearer private-ai-key" });
    const sentContent = aiRequest.messages.find(({ role }) => role === "user")?.content ?? "";
    expect(sentContent).toContain("Visible description");
    expect(sentContent).not.toContain("private.png");
    expect(sentContent).not.toContain("other.png");
    expect(sentContent).not.toContain("reference.png");
    releaseAiFetch();
    aiFetchGate = null;
    const createdIssueId = json<{ id: number }>(response).id;
    await vi.waitFor(async () => expect(await prisma.issueLabel.count({ where: { issueId: createdIssueId } })).toBe(1));

    const urgent = await prisma.label.findUniqueOrThrow({ where: { name: "urgent" } });
    expect((await app.inject({ method: "POST", url: "/api/issues", headers: { cookie: userACookie }, payload: { title: "Already labeled", labelIds: [urgent.id] } })).statusCode).toBe(201);
    expect(aiFetchCalls).toHaveLength(1);

    await app.inject({ method: "PUT", url: "/api/admin/settings", headers: { cookie: adminCookie }, payload: {
      name: "IssueFlow", description: "", logoUrl: "", defaultPageSize: 20, allowUserCreateIssue: true,
      aiEnabled: false, aiUrl: "https://ai.example.com/v1/chat/completions", aiModel: "test-model", clearAiApiKey: false, aiMaxLabels: 2,
    } });
  });

  it("groups awaiting acceptance into the open homepage filter and returns all states without a filter", async () => {
    const prefix = "Homepage state grouping";
    const created = await Promise.all([
      prisma.issue.create({ data: { title: `${prefix} open`, authorId: userAId, state: "OPEN" } }),
      prisma.issue.create({ data: { title: `${prefix} awaiting`, authorId: userAId, state: "AWAITING_ACCEPTANCE" } }),
      prisma.issue.create({ data: { title: `${prefix} closed`, authorId: userAId, state: "CLOSED", closedAt: new Date() } }),
    ]);
    const open = await app.inject({ method: "GET", url: `/api/issues?state=OPEN&q=${encodeURIComponent(prefix)}&pageSize=100`, headers: { cookie: userACookie } });
    expect(open.statusCode).toBe(200);
    expect(json<{ items: Array<{ id: number }> }>(open).items.map(({ id }) => id).sort((a, b) => a - b)).toEqual(created.slice(0, 2).map(({ id }) => id).sort((a, b) => a - b));

    const all = await app.inject({ method: "GET", url: `/api/issues?q=${encodeURIComponent(prefix)}&pageSize=100`, headers: { cookie: userACookie } });
    expect(all.statusCode).toBe(200);
    expect(json<{ items: Array<{ id: number }> }>(all).items.map(({ id }) => id).sort((a, b) => a - b)).toEqual(created.map(({ id }) => id).sort((a, b) => a - b));
  });

  it("uploads, lists and reads attachments while enforcing authentication and delete permissions", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const anonymousUpload = multipartImage(png, "image/png", "anonymous.png");
    expect((await app.inject({ method: "POST", url: `/api/issues/${issueId}/attachments`, headers: anonymousUpload.headers, payload: anonymousUpload.payload })).statusCode).toBe(401);
    const upload = multipartImage(png, "image/png", "screenshot.png");
    const response = await app.inject({ method: "POST", url: `/api/issues/${issueId}/attachments`, headers: { ...upload.headers, cookie: userACookie }, payload: upload.payload });
    expect(response.statusCode).toBe(201);
    const saved = json<{ id: number; fileName: string; mimeType: string; size: number; url: string; canDelete: boolean }>(response);
    attachmentId = saved.id;
    expect(saved).toMatchObject({ fileName: "screenshot.png", mimeType: "image/png", size: png.length, url: `/api/attachments/${saved.id}/content`, canDelete: true });

    const list = await app.inject({ method: "GET", url: `/api/issues/${issueId}/attachments`, headers: { cookie: userBCookie } });
    expect(list.statusCode).toBe(200);
    expect(json<{ attachments: Array<{ id: number; canDelete: boolean; uploader: { username: string } }> }>(list).attachments[0]).toMatchObject({ id: saved.id, canDelete: false, uploader: { username: "alice" } });

    const anonymous = await app.inject({ method: "GET", url: saved.url });
    expect(anonymous.statusCode).toBe(401);
    const content = await app.inject({ method: "GET", url: saved.url, headers: { cookie: userACookie } });
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toBe("image/png");
    expect(content.headers["content-disposition"]).toContain("inline");
    expect(content.headers["x-content-type-options"]).toBe("nosniff");
    expect(content.rawPayload.equals(png)).toBe(true);

    const denied = await app.inject({ method: "DELETE", url: `/api/attachments/${saved.id}`, headers: { cookie: userBCookie } });
    expect(denied.statusCode).toBe(403);
    expect(await prisma.timelineEvent.count({ where: { issueId, type: "ATTACHMENT_ADDED" } })).toBe(1);
  });

  it("accepts arbitrary attachment types while retaining name, size and count limits", async () => {
    const textContents = Buffer.from("plain text attachment");
    const text = multipartImage(textContents, "text/plain", "notes.txt");
    const accepted = await app.inject({ method: "POST", url: `/api/issues/${issueId}/attachments`, headers: { ...text.headers, cookie: userACookie }, payload: text.payload });
    expect(accepted.statusCode).toBe(201);
    expect(json<{ mimeType: string; fileName: string }>(accepted)).toMatchObject({ mimeType: "text/plain", fileName: "notes.txt" });
    const textContent = await app.inject({ method: "GET", url: json<{ url: string }>(accepted).url, headers: { cookie: userACookie } });
    expect(textContent.statusCode).toBe(200);
    expect(textContent.headers["content-type"]).toBe("text/plain");
    expect(textContent.headers["content-disposition"]).toContain("attachment");
    expect(textContent.headers["x-content-type-options"]).toBe("nosniff");
    expect(textContent.rawPayload.equals(textContents)).toBe(true);

    const traversing = multipartImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png", "../../escape.png");
    const traversalRejected = await app.inject({ method: "POST", url: `/api/issues/${issueId}/attachments`, headers: { ...traversing.headers, cookie: userACookie }, payload: traversing.payload });
    expect(traversalRejected.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(traversalRejected).error.code).toBe("INVALID_ATTACHMENT_NAME");

    const longName = multipartImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png", `${"a".repeat(252)}.png`);
    const longNameRejected = await app.inject({ method: "POST", url: `/api/issues/${issueId}/attachments`, headers: { ...longName.headers, cookie: userACookie }, payload: longName.payload });
    expect(longNameRejected.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(longNameRejected).error.code).toBe("INVALID_ATTACHMENT_NAME");

    const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    const tooLarge = multipartImage(bytes, "image/png", "large.png");
    const rejected = await app.inject({ method: "POST", url: `/api/issues/${issueId}/attachments`, headers: { ...tooLarge.headers, cookie: userACookie }, payload: tooLarge.payload });
    expect(rejected.statusCode).toBe(413);
    expect(json<{ error: { code: string } }>(rejected).error.code).toBe("ATTACHMENT_TOO_LARGE");

    const cappedIssue = await prisma.issue.create({ data: { title: "Attachment count cap", authorId: userAId } });
    await prisma.issueAttachment.createMany({ data: Array.from({ length: 20 }, (_, index) => ({ issueId: cappedIssue.id, uploaderId: userAId, fileName: `file-${index}.txt`, storageName: `limit-${index}`, mimeType: "text/plain", size: 1 })) });
    const overCount = multipartImage(Buffer.from("one more"), "application/octet-stream", "one-more.bin");
    const countRejected = await app.inject({ method: "POST", url: `/api/issues/${cappedIssue.id}/attachments`, headers: { ...overCount.headers, cookie: userACookie }, payload: overCount.payload });
    expect(countRejected.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(countRejected).error.code).toBe("ATTACHMENT_LIMIT_REACHED");
  });

  it("allows an assignee to move an issue through awaiting acceptance and closed states but rejects content edits", async () => {
    const comment = await app.inject({ method: "POST", url: `/api/issues/${issueId}/comments`, headers: { cookie: userBCookie }, payload: { body: "I am on it" } });
    expect(comment.statusCode).toBe(201);
    const detail = await app.inject({ method: "GET", url: `/api/issues/${issueId}`, headers: { cookie: userBCookie } });
    const updatedAt = json<{ updatedAt: string }>(detail).updatedAt;
    const awaiting = await app.inject({ method: "PATCH", url: `/api/issues/${issueId}`, headers: { cookie: userBCookie }, payload: { state: "AWAITING_ACCEPTANCE", updatedAt } });
    expect(awaiting.statusCode).toBe(200);
    expect(json<{ state: string; closedAt: string | null }>(awaiting)).toMatchObject({ state: "AWAITING_ACCEPTANCE", closedAt: null });
    expect(await prisma.timelineEvent.count({ where: { issueId, type: "ISSUE_AWAITING_ACCEPTANCE" } })).toBe(1);
    const closed = await app.inject({ method: "PATCH", url: `/api/issues/${issueId}`, headers: { cookie: userBCookie }, payload: { state: "CLOSED", updatedAt: json<{ updatedAt: string }>(awaiting).updatedAt } });
    expect(closed.statusCode).toBe(200);
    const edit = await app.inject({ method: "PATCH", url: `/api/issues/${issueId}`, headers: { cookie: userBCookie }, payload: { title: "Hijacked", updatedAt: json<{ updatedAt: string }>(closed).updatedAt } });
    expect(edit.statusCode).toBe(403);
  });

  it("exports the filtered template structure as a valid XLSX", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/issues/export.xlsx" });
    expect(anonymous.statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/issues/export.xlsx", headers: { cookie: userACookie } })).statusCode).toBe(400);
    const openIssue = await prisma.issue.create({ data: { title: "Broken open export", body: "Always include", authorId: userAId } });
    const awaitingIssue = await prisma.issue.create({ data: { title: "Broken awaiting export", body: "Always include pending acceptance", authorId: userAId, state: "AWAITING_ACCEPTANCE" } });
    const outsideClosedIssue = await prisma.issue.create({ data: { title: "Broken old closed export", body: "Outside range", authorId: userAId, state: "CLOSED", closedAt: new Date("2020-01-15T12:00:00.000Z") } });
    const closedFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const closedTo = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const response = await app.inject({ method: "GET", url: `/api/issues/export.xlsx?state=CLOSED&q=Broken&sort=createdAt&order=asc&closedFrom=${encodeURIComponent(closedFrom)}&closedTo=${encodeURIComponent(closedTo)}`, headers: { cookie: userACookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(response.headers["content-disposition"]).toContain("filename*=UTF-8''");
    const workbook = new ExcelJS.Workbook();
    const workbookBytes = Uint8Array.from(response.rawPayload);
    await workbook.xlsx.load(workbookBytes.buffer);
    const sheet = workbook.getWorksheet("需求进度管理");
    expect(sheet?.getRow(4).values).toEqual([undefined, "产品需求", "产品负责人", "状态", "需求明细", "附件：图片", "备注", "技术责任人", "状态", "预估人日", "计划开始时间", "计划完成时间", "开发进度", "研发自测", "产品验收"]);
    const exportedTitles = Array.from({ length: sheet?.rowCount ?? 0 }, (_, index) => sheet!.getCell(index + 1, 1)).filter((cell) => cell.master.address === cell.address).map((cell) => cell.value).filter((value): value is string => typeof value === "string" && value.startsWith("#"));
    expect(exportedTitles).toContain(`#${issueId} Broken flow`);
    expect(exportedTitles).toContain(`#${openIssue.id} Broken open export`);
    expect(exportedTitles).toContain(`#${awaitingIssue.id} Broken awaiting export`);
    expect(exportedTitles).not.toContain(`#${outsideClosedIssue.id} Broken old closed export`);
    expect(exportedTitles).toHaveLength(3);
    expect(sheet?.getImages().length).toBe(1);
    expect(workbook.getWorksheet("用户反馈跟踪记录")?.getRow(1).values).toEqual([undefined, "问题描述", "类型", "优先级", "状态", "反馈者", "跟进人", "附件", "反馈时间", "备注说明"]);
  });

  it("lets the uploader delete an attachment and records the removal", async () => {
    const response = await app.inject({ method: "DELETE", url: `/api/attachments/${attachmentId}`, headers: { cookie: userACookie } });
    expect(response.statusCode).toBe(204);
    expect(await prisma.issueAttachment.findUnique({ where: { id: attachmentId } })).toBeNull();
    expect(await prisma.timelineEvent.count({ where: { issueId, type: "ATTACHMENT_REMOVED" } })).toBe(1);
  });

  it("combines filters and invalidates a disabled user's sessions", async () => {
    const filtered = await app.inject({ method: "GET", url: `/api/issues?state=CLOSED&assigneeId=${userBId}&q=Broken`, headers: { cookie: userACookie } });
    expect(json<{ pagination: { total: number } }>(filtered).pagination.total).toBe(1);
    const disabled = await app.inject({ method: "PATCH", url: `/api/admin/users/${userBId}`, headers: { cookie: adminCookie }, payload: { active: false } });
    expect(disabled.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: userBCookie } });
    expect(me.statusCode).toBe(401);
    expect(await prisma.apiToken.count({ where: { userId: userBId } })).toBe(0);
    const tokenMe = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${userBApiToken}` } });
    expect(tokenMe.statusCode).toBe(401);
  });

  it("persists settings and rejects stale issue writes", async () => {
    const setting = await app.inject({ method: "PUT", url: "/api/admin/settings", headers: { cookie: adminCookie }, payload: { name: "Acme Issues", description: "Tracker", logoUrl: "", defaultPageSize: 25, allowUserCreateIssue: true, aiEnabled: false, aiUrl: "", aiModel: "", clearAiApiKey: false, aiMaxLabels: 3 } });
    expect(json<{ name: string }>(setting).name).toBe("Acme Issues");
    const stale = await app.inject({ method: "PATCH", url: `/api/issues/${issueId}`, headers: { cookie: userACookie }, payload: { title: "Old write", updatedAt: "2020-01-01T00:00:00.000Z" } });
    expect(stale.statusCode).toBe(409);
  });

  it("restricts Yunxiao configuration to admins and never returns credential plaintext", async () => {
    const deniedRead = await app.inject({ method: "GET", url: "/api/admin/integrations/yunxiao", headers: { cookie: userACookie } });
    const deniedWrite = await app.inject({ method: "PUT", url: "/api/admin/integrations/yunxiao", headers: { cookie: userACookie }, payload: {} });
    expect(deniedRead.statusCode).toBe(403);
    expect(deniedWrite.statusCode).toBe(403);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/admin/integrations/yunxiao",
      headers: { cookie: adminCookie },
      payload: {
        enabled: true, edition: "CENTRAL", baseUrl: "https://openapi-rdc.aliyuncs.com/",
        organizationId: "org-1", repositoryId: "group/repo", repositoryName: "repo",
        repositoryWebUrl: "https://codeup.aliyun.com/group/repo", token: "pt-plain-token", webhookSecret: "hook-plain-secret",
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("pt-plain-token");
    expect(saved.body).not.toContain("hook-plain-secret");
    expect(json<{ integration: { hasToken: boolean; hasWebhookSecret: boolean; baseUrl: string }; webhook: { url: string } }>(saved)).toMatchObject({
      integration: { hasToken: true, hasWebhookSecret: true, baseUrl: "https://openapi-rdc.aliyuncs.com" },
      webhook: { url: "https://issues.example.com/api/integrations/yunxiao/webhook" },
    });
    const stored = await prisma.yunxiaoIntegration.findUniqueOrThrow({ where: { id: 1 } });
    expect(stored.tokenEncrypted).not.toContain("pt-plain-token");
    expect(stored.webhookSecretEncrypted).not.toContain("hook-plain-secret");

    const read = await app.inject({ method: "GET", url: "/api/admin/integrations/yunxiao", headers: { cookie: adminCookie } });
    expect(read.body).not.toContain("pt-plain-token");
    expect(read.body).not.toContain("hook-plain-secret");
  });

  it("tests the central-edition repository URL and creates a webhook without real network access", async () => {
    fetchCalls.length = 0;
    const tested = await app.inject({ method: "POST", url: "/api/admin/integrations/yunxiao/test", headers: { cookie: adminCookie }, payload: {} });
    expect(tested.statusCode).toBe(200);
    expect(fetchCalls[0]?.url).toBe("https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/org-1/repositories/group%2Frepo");
    expect(new Headers(fetchCalls[0]?.init?.headers).get("x-yunxiao-token")).toBe("pt-plain-token");

    const created = await app.inject({ method: "POST", url: "/api/admin/integrations/yunxiao/create-webhook", headers: { cookie: adminCookie } });
    expect(created.statusCode).toBe(200);
    expect(json<{ webhookId: number }>(created).webhookId).toBe(88);
    expect(fetchCalls[1]?.url).toBe("https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/org-1/repositories/group%2Frepo/webhooks");
    const body = JSON.parse(String(fetchCalls[1]?.init?.body)) as { token: string; url: string; pushEvents: boolean; mergeRequestsEvents: boolean };
    expect(body).toMatchObject({ token: "hook-plain-secret", url: "https://issues.example.com/api/integrations/yunxiao/webhook", pushEvents: true, mergeRequestsEvents: true });
  });

  it("rejects a wrong webhook secret and associates old-style push payloads idempotently", async () => {
    const issue = await prisma.issue.create({ data: { title: "Yunxiao push", authorId: userAId, subscriptions: { create: { userId: userAId } } } });
    const payload = {
      object_kind: "push", ref: `refs/heads/feature/issue-${issue.id}`,
      project: { web_url: "https://codeup.aliyun.com/group/repo" },
      commits: [{ id: "abc123", message: `work on #${issue.id}`, url: "https://codeup.aliyun.com/group/repo/commit/abc123", author: { name: "Alice" } }],
    };
    const denied = await app.inject({ method: "POST", url: "/api/integrations/yunxiao/webhook", headers: { "x-codeup-token": "wrong", "x-codeup-event": "Push Hook" }, payload });
    expect(denied.statusCode).toBe(401);

    const headers = { "x-codeup-token": "hook-plain-secret", "x-codeup-event": "Push Hook", "x-codeup-event-uuid": "push-1" };
    const accepted = await app.inject({ method: "POST", url: "/api/integrations/yunxiao/webhook", headers, payload });
    const duplicate = await app.inject({ method: "POST", url: "/api/integrations/yunxiao/webhook", headers, payload });
    expect(accepted.statusCode).toBe(202);
    expect(json<{ duplicate: boolean }>(accepted).duplicate).toBe(false);
    expect(json<{ duplicate: boolean }>(duplicate).duplicate).toBe(true);
    expect(await prisma.codeReference.count({ where: { issueId: issue.id, type: "COMMIT", externalId: "abc123" } })).toBe(1);
    expect(await prisma.webhookDelivery.count({ where: { deliveryKey: "push-1", status: "PROCESSED" } })).toBe(1);

    const references = await app.inject({ method: "GET", url: `/api/issues/${issue.id}/code-references`, headers: { cookie: userACookie } });
    expect(references.statusCode).toBe(200);
    expect(json<{ references: Array<{ commitSha: string }> }>(references).references[0]?.commitSha).toBe("abc123");
  });

  it("closes and reopens issues from Yunxiao push commit commands", async () => {
    const issue = await prisma.issue.create({ data: { title: "Yunxiao commit commands", authorId: userAId, subscriptions: { create: { userId: userAId } } } });
    const headers = { "x-codeup-token": "hook-plain-secret", "x-codeup-event": "Push Hook" };
    const push = (deliveryId: string, sha: string, message: string) => app.inject({
      method: "POST",
      url: "/api/integrations/yunxiao/webhook",
      headers: { ...headers, "x-codeup-event-uuid": deliveryId },
      payload: {
        object_kind: "push",
        ref: "refs/heads/main",
        project: { web_url: "https://codeup.aliyun.com/group/repo" },
        commits: [{ id: sha, message, author: { name: "Alice" } }],
      },
    });

    const closed = await push("push-command-close", "close456", `完成开发 #C${issue.id}`);
    expect(closed.statusCode).toBe(202);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).state).toBe("CLOSED");
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).closedAt).not.toBeNull();
    expect(await prisma.codeReference.count({ where: { issueId: issue.id, type: "COMMIT", externalId: "close456" } })).toBe(1);
    expect(await prisma.timelineEvent.count({ where: { issueId: issue.id, type: "ISSUE_CLOSED_BY_YUNXIAO_COMMIT" } })).toBe(1);
    expect(await prisma.notification.count({ where: { issueId: issue.id, userId: userAId, type: "YUNXIAO_COMMIT_CLOSED" } })).toBe(1);

    const repeatedClose = await push("push-command-close-again", "close789", `无需重复关闭 #c${issue.id}`);
    expect(repeatedClose.statusCode).toBe(202);
    expect(await prisma.timelineEvent.count({ where: { issueId: issue.id, type: "ISSUE_CLOSED_BY_YUNXIAO_COMMIT" } })).toBe(1);
    expect(await prisma.notification.count({ where: { issueId: issue.id, type: "YUNXIAO_COMMIT_CLOSED" } })).toBe(1);

    const awaiting = await push("push-command-awaiting", "awaiting456", `提交验收 #a${issue.id}`);
    expect(awaiting.statusCode).toBe(202);
    const awaitingIssue = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(awaitingIssue.state).toBe("AWAITING_ACCEPTANCE");
    expect(awaitingIssue.closedAt).toBeNull();
    expect(await prisma.codeReference.count({ where: { issueId: issue.id, type: "COMMIT", externalId: "awaiting456" } })).toBe(1);
    expect(await prisma.timelineEvent.count({ where: { issueId: issue.id, type: "ISSUE_AWAITING_ACCEPTANCE_BY_YUNXIAO_COMMIT" } })).toBe(1);
    expect(await prisma.notification.count({ where: { issueId: issue.id, userId: userAId, type: "YUNXIAO_COMMIT_AWAITING_ACCEPTANCE" } })).toBe(1);

    const reopened = await push("push-command-open", "open456", `先待验收 #a${issue.id}，最终开启 #o${issue.id}`);
    expect(reopened.statusCode).toBe(202);
    const reopenedIssue = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(reopenedIssue.state).toBe("OPEN");
    expect(reopenedIssue.closedAt).toBeNull();
    expect(await prisma.codeReference.count({ where: { issueId: issue.id, type: "COMMIT", externalId: "open456" } })).toBe(1);
    expect(await prisma.timelineEvent.count({ where: { issueId: issue.id, type: "ISSUE_REOPENED_BY_YUNXIAO_COMMIT" } })).toBe(1);
    expect(await prisma.notification.count({ where: { issueId: issue.id, userId: userAId, type: "YUNXIAO_COMMIT_REOPENED" } })).toBe(1);

    const referenced = await push("push-command-reference-only", "ref456", `普通引用 #${issue.id}`);
    expect(referenced.statusCode).toBe(202);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).state).toBe("OPEN");
  });

  it("upserts new-style merge requests and closes an issue once after a merged closing reference", async () => {
    const issue = await prisma.issue.create({ data: { title: "Yunxiao MR", authorId: userAId, subscriptions: { create: { userId: userAId } } } });
    const openedPayload = {
      eventType: "MERGE_REQUEST", user: { name: "Alice" },
      project: { webUrl: "https://codeup.aliyun.com/group/repo" },
      objectAttributes: { localId: 27, title: `Implement fixes #${issue.id}`, description: "ready", state: "opened", sourceBranch: `feature/${issue.id}`, targetBranch: "main", webUrl: "https://codeup.aliyun.com/group/repo/merge_requests/27" },
    };
    const opened = await app.inject({ method: "POST", url: "/api/integrations/yunxiao/webhook", headers: { "x-codeup-token": "hook-plain-secret", "x-codeup-event-uuid": "mr-open-27" }, payload: openedPayload });
    expect(opened.statusCode).toBe(202);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).state).toBe("OPEN");
    await prisma.issue.update({ where: { id: issue.id }, data: { state: "AWAITING_ACCEPTANCE" } });

    const mergedPayload = { ...openedPayload, objectAttributes: { ...openedPayload.objectAttributes, state: "merged", action: "merge" } };
    const mergedHeaders = { "x-codeup-token": "hook-plain-secret", "x-codeup-event": "Merge Request Hook", "x-codeup-event-uuid": "mr-merged-27" };
    const merged = await app.inject({ method: "POST", url: "/api/integrations/yunxiao/webhook", headers: mergedHeaders, payload: mergedPayload });
    const duplicate = await app.inject({ method: "POST", url: "/api/integrations/yunxiao/webhook", headers: mergedHeaders, payload: mergedPayload });
    expect(merged.statusCode).toBe(202);
    expect(json<{ duplicate: boolean }>(duplicate).duplicate).toBe(true);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).state).toBe("CLOSED");
    expect(await prisma.codeReference.count({ where: { issueId: issue.id, type: "MERGE_REQUEST", externalId: "27", status: "MERGED" } })).toBe(1);
    expect(await prisma.timelineEvent.count({ where: { issueId: issue.id, type: "ISSUE_CLOSED_BY_YUNXIAO_MR" } })).toBe(1);
    expect(await prisma.notification.count({ where: { issueId: issue.id, userId: userAId, type: "YUNXIAO_MR_MERGED" } })).toBe(1);
  });

  it("accepts legacy snake-case merge request payloads", async () => {
    const issue = await prisma.issue.create({ data: { title: "Legacy MR", authorId: userAId } });
    const payload = {
      object_kind: "merge_request", user: { name: "Alice" }, project: { web_url: "https://codeup.aliyun.com/group/repo" },
      object_attributes: { iid: 31, title: `Resolve #${issue.id}`, description: "legacy payload", state: "merged", action: "merge", source_branch: "feature/legacy", target_branch: "main", url: "https://codeup.aliyun.com/group/repo/merge_requests/31" },
    };
    const response = await app.inject({ method: "POST", url: "/api/integrations/yunxiao/webhook", headers: { "x-codeup-token": "hook-plain-secret", "x-codeup-event": "Merge Request Hook", "x-codeup-event-uuid": "mr-legacy-31" }, payload });
    expect(response.statusCode).toBe(202);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).state).toBe("CLOSED");
    expect(await prisma.codeReference.count({ where: { issueId: issue.id, externalId: "31", status: "MERGED" } })).toBe(1);
  });

  it("allows non-sensitive reads but blocks credential writes and external calls without an encryption key", async () => {
    const previous = process.env.YUNXIAO_ENCRYPTION_KEY;
    delete process.env.YUNXIAO_ENCRYPTION_KEY;
    const appWithoutKey = await buildApp({ prisma, yunxiao: { webhookBaseUrl: "https://issues.example.com", fetchImpl: mockFetch } });
    try {
      expect((await appWithoutKey.inject({ method: "GET", url: "/api/admin/integrations/yunxiao", headers: { cookie: adminCookie } })).statusCode).toBe(200);
      const stored = await prisma.yunxiaoIntegration.findUniqueOrThrow({ where: { id: 1 } });
      const blockedWrite = await appWithoutKey.inject({ method: "PUT", url: "/api/admin/integrations/yunxiao", headers: { cookie: adminCookie }, payload: {
        enabled: stored.enabled, edition: stored.edition, baseUrl: stored.baseUrl, organizationId: stored.organizationId,
        repositoryId: stored.repositoryId, repositoryName: stored.repositoryName, repositoryWebUrl: stored.repositoryWebUrl, token: "replacement-token",
      } });
      expect(blockedWrite.statusCode).toBe(503);
      expect(json<{ error: { code: string } }>(blockedWrite).error.code).toBe("YUNXIAO_ENCRYPTION_KEY_MISSING");
      const blockedCall = await appWithoutKey.inject({ method: "POST", url: "/api/admin/integrations/yunxiao/test", headers: { cookie: adminCookie }, payload: {} });
      expect(blockedCall.statusCode).toBe(503);
    } finally {
      await appWithoutKey.close();
      if (previous !== undefined) process.env.YUNXIAO_ENCRYPTION_KEY = previous;
    }
  });
});
