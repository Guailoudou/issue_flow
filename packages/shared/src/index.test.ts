import { describe, expect, it } from "vitest";
import { changePasswordSchema, commitActionSchema, createApiTokenSchema, createIssueSchema, issueExportQuerySchema, issueQuerySchema, labelSchema, ossSettingSchema, registerUserSchema, updateProfileSchema, updateUserSchema, yunxiaoIntegrationSchema } from "./index";

describe("shared API schemas", () => {
  it("trims and validates issue titles", () => {
    expect(createIssueSchema.parse({ title: "  Bug  " }).title).toBe("Bug");
    expect(() => createIssueSchema.parse({ title: " " })).toThrow();
  });

  it("coerces pagination query values", () => {
    expect(issueQuerySchema.parse({ page: "2", pageSize: "25" })).toMatchObject({ page: 2, pageSize: 25 });
    expect(issueQuerySchema.safeParse({ state: "AWAITING_ACCEPTANCE" }).success).toBe(false);
    expect(issueQuerySchema.parse({ labelIds: "2,3,2" }).labelIds).toEqual([2, 3]);
  });

  it("validates invite registration with the same user fields", () => {
    expect(registerUserSchema.parse({ username: " new_user ", displayName: " New User ", email: "new@example.com", password: "password-123", inviteCode: " invite-123 " })).toMatchObject({ username: "new_user", displayName: "New User", inviteCode: "invite-123" });
    expect(registerUserSchema.safeParse({ username: "x", displayName: "New User", password: "short", inviteCode: "invite-123" }).success).toBe(false);
  });

  it("validates API Token names and supported expiry periods", () => {
    expect(createApiTokenSchema.parse({ name: "  CI 发布  " })).toEqual({ name: "CI 发布", expiresInDays: 90 });
    expect(createApiTokenSchema.parse({ name: "长期集成", expiresInDays: null })).toEqual({ name: "长期集成", expiresInDays: null });
    expect(createApiTokenSchema.safeParse({ name: "测试", expiresInDays: 7 }).success).toBe(false);
  });

  it("validates independent profile, password and administrator username changes", () => {
    expect(updateProfileSchema.parse({ displayName: "  新名称  " })).toEqual({ displayName: "新名称" });
    expect(changePasswordSchema.safeParse({ currentPassword: "old-password", newPassword: "new-password" }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: "same-password", newPassword: "same-password" }).success).toBe(false);
    expect(updateUserSchema.parse({ username: " renamed_user " })).toEqual({ username: "renamed_user" });
  });

  it("validates the closed issue export range", () => {
    expect(issueExportQuerySchema.safeParse({ closedFrom: "2026-08-01T00:00:00.000Z", closedTo: "2026-08-31T23:59:59.999Z" }).success).toBe(true);
    expect(issueExportQuerySchema.safeParse({ closedFrom: "2026-09-01T00:00:00.000Z", closedTo: "2026-08-31T23:59:59.999Z" }).success).toBe(false);
  });

  it("only accepts six digit label colors", () => {
    expect(labelSchema.safeParse({ name: "bug", color: "d73a4a" }).success).toBe(true);
    expect(labelSchema.safeParse({ name: "bug", color: "red" }).success).toBe(false);
  });

  it("requires commit actions to change state or add labels", () => {
    expect(commitActionSchema.parse({ name: "关闭", keyword: "C", state: "CLOSED" }).keyword).toBe("c");
    expect(commitActionSchema.safeParse({ name: "空操作", keyword: "noop", state: null, labelIds: [] }).success).toBe(false);
  });

  it("validates Yunxiao edition-specific configuration and strips a trailing slash", () => {
    expect(yunxiaoIntegrationSchema.parse({
      enabled: false, edition: "REGION", baseUrl: "https://example.aliyuncs.com/", repositoryId: "group/repo",
    }).baseUrl).toBe("https://example.aliyuncs.com");
    expect(yunxiaoIntegrationSchema.safeParse({
      enabled: false, edition: "CENTRAL", baseUrl: "https://example.aliyuncs.com", repositoryId: "repo", organizationId: "",
    }).success).toBe(false);
  });

  it("normalizes safe S3 endpoints, buckets and object prefixes", () => {
    expect(ossSettingSchema.parse({ storageMode: "S3", endpoint: "https://s3.oss-cn-hangzhou.aliyuncs.com/", region: "", bucket: "issueflow.test", prefix: "/issueflow/attachments/" })).toMatchObject({ endpoint: "https://s3.oss-cn-hangzhou.aliyuncs.com", region: "", bucket: "issueflow.test", prefix: "issueflow/attachments", forcePathStyle: false, clearCredentials: false });
    expect(ossSettingSchema.safeParse({ storageMode: "S3", endpoint: "ftp://example.com", bucket: "issueflow-test", prefix: "../files" }).success).toBe(false);
    expect(ossSettingSchema.safeParse({ storageMode: "S3", endpoint: "https://s3.example.com", bucket: "issueflow-test", prefix: "files", accessKeyId: "new", clearCredentials: true }).success).toBe(false);
    expect(ossSettingSchema.parse({ storageMode: "WEBDAV", webdavUrl: "https://dav.example.com/", webdavPath: "/issueflow/files/" })).toMatchObject({ webdavUrl: "https://dav.example.com", webdavPath: "issueflow/files" });
    expect(ossSettingSchema.safeParse({ storageMode: "WEBDAV", webdavUrl: "ftp://dav.example.com", webdavPath: "../files" }).success).toBe(false);
  });
});
