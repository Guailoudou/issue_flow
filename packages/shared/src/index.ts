import { z } from "zod";

export const USER_ROLES = ["ADMIN", "USER"] as const;
export const BUSINESS_ROLES = ["MANAGEMENT", "DEVELOPMENT", "PRODUCT"] as const;
export const ISSUE_STATES = ["OPEN", "AWAITING_ACCEPTANCE", "CLOSED"] as const;
export const MILESTONE_STATES = ["OPEN", "CLOSED"] as const;
export const SORT_FIELDS = ["createdAt", "updatedAt"] as const;
export const YUNXIAO_EDITIONS = ["CENTRAL", "REGION"] as const;

export const usernameSchema = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/);
export const passwordSchema = z.string().min(8).max(128);
export const idSchema = z.coerce.number().int().positive();
export const optionalEmailSchema = z.union([z.literal(""), z.string().email().max(254)]).optional();

export const loginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) });
export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80),
  email: optionalEmailSchema,
});
export const registerUserSchema = createUserSchema.extend({
  inviteCode: z.string().trim().min(1).max(4000),
});
export const updateUserSchema = z.object({
  username: usernameSchema.optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  email: optionalEmailSchema,
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
export const updateUserRolesSchema = z.object({ roles: z.array(z.enum(BUSINESS_ROLES)).min(1).max(BUSINESS_ROLES.length) });
export const resetPasswordSchema = z.object({ password: passwordSchema });
export const updateProfileSchema = z.object({ displayName: z.string().trim().min(1).max(80) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
}).refine((value) => value.currentPassword !== value.newPassword, { path: ["newPassword"], message: "New password must differ from current password" });

export const platformSettingSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500),
  logoUrl: z.union([z.literal(""), z.string().url().max(1000)]),
  defaultPageSize: z.number().int().min(5).max(100),
  allowUserCreateIssue: z.boolean(),
});

const aiUrlSchema = z.union([z.literal(""), z.string().trim().url().max(1000).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "AI URL must use HTTP or HTTPS")]);
export const adminPlatformSettingSchema = platformSettingSchema.extend({
  aiEnabled: z.boolean(),
  aiUrl: aiUrlSchema,
  aiModel: z.string().trim().max(200),
  aiApiKey: z.string().trim().min(1).max(4000).optional(),
  clearAiApiKey: z.boolean().default(false),
  aiMaxLabels: z.number().int().min(1).max(5),
}).superRefine((value, context) => {
  if (value.aiEnabled && !value.aiUrl) context.addIssue({ code: "custom", path: ["aiUrl"], message: "AI URL is required when AI labeling is enabled" });
  if (value.aiEnabled && !value.aiModel) context.addIssue({ code: "custom", path: ["aiModel"], message: "AI model is required when AI labeling is enabled" });
  if (value.aiApiKey && value.clearAiApiKey) context.addIssue({ code: "custom", path: ["clearAiApiKey"], message: "Cannot set and clear the AI API key at the same time" });
});

export const labelSchema = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().max(200).default(""),
  color: z.string().regex(/^[0-9a-fA-F]{6}$/),
});
export const milestoneSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""),
  dueDate: z.string().datetime().nullable().optional(),
  state: z.enum(MILESTONE_STATES).default("OPEN"),
});

const relationsSchema = z.object({
  assigneeIds: z.array(idSchema).max(20).optional(),
  productOwnerIds: z.array(idSchema).max(20).optional(),
  developerOwnerIds: z.array(idSchema).max(20).optional(),
  labelIds: z.array(idSchema).max(30).optional(),
  milestoneId: idSchema.nullable().optional(),
});
export const createIssueSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(100_000).default(""),
}).merge(relationsSchema);
export const updateIssueSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(100_000).optional(),
  state: z.enum(ISSUE_STATES).optional(),
  updatedAt: z.string().datetime(),
}).merge(relationsSchema);
export const issueQuerySchema = z.object({
  state: z.enum(ISSUE_STATES).optional(),
  authorId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  labelId: idSchema.optional(),
  labelIds: z.string().trim().regex(/^\d+(,\d+)*$/).transform((value) => [...new Set(value.split(",").map(Number))]).refine((value) => value.length <= 30 && value.every((id) => Number.isSafeInteger(id) && id > 0)).optional(),
  milestoneId: idSchema.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(SORT_FIELDS).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export const issueExportQuerySchema = issueQuerySchema.omit({ state: true, page: true, pageSize: true }).extend({
  closedFrom: z.string().datetime(),
  closedTo: z.string().datetime(),
}).superRefine((value, context) => {
  if (Date.parse(value.closedFrom) > Date.parse(value.closedTo)) context.addIssue({ code: "custom", path: ["closedTo"], message: "closedTo must not be earlier than closedFrom" });
});

export const commentSchema = z.object({ body: z.string().trim().min(1).max(50_000) });
export const updateCommentSchema = commentSchema.extend({ updatedAt: z.string().datetime().optional() });
export const subscriptionSchema = z.object({ subscribed: z.boolean() });
export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
});

const yunxiaoBaseUrlSchema = z.string().trim().url().max(1000).transform((value) => value.replace(/\/+$/, ""));
export const yunxiaoIntegrationSchema = z.object({
  enabled: z.boolean(),
  edition: z.enum(YUNXIAO_EDITIONS),
  baseUrl: yunxiaoBaseUrlSchema,
  organizationId: z.string().trim().max(200).default(""),
  repositoryId: z.string().trim().min(1).max(1000),
  repositoryName: z.string().trim().max(300).default(""),
  repositoryWebUrl: z.union([z.literal(""), z.string().trim().url().max(1000)]).default(""),
  token: z.string().trim().min(1).max(4000).optional(),
  webhookSecret: z.string().min(1).max(4000).optional(),
}).superRefine((value, context) => {
  if (value.edition === "CENTRAL" && !value.organizationId) context.addIssue({ code: "custom", path: ["organizationId"], message: "Central edition requires an organization ID" });
});

export const yunxiaoTestSchema = z.object({
  token: z.string().trim().min(1).max(4000).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type RegisterUserInput = z.infer<typeof registerUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type PlatformSettingInput = z.infer<typeof platformSettingSchema>;
export type AdminPlatformSettingInput = z.infer<typeof adminPlatformSettingSchema>;
export type LabelInput = z.infer<typeof labelSchema>;
export type MilestoneInput = z.infer<typeof milestoneSchema>;
export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
export type IssueQuery = z.infer<typeof issueQuerySchema>;
export type IssueExportQuery = z.infer<typeof issueExportQuerySchema>;
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
export type YunxiaoIntegrationInput = z.infer<typeof yunxiaoIntegrationSchema>;

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export interface Page<T> {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: (typeof USER_ROLES)[number];
  roles: (typeof BUSINESS_ROLES)[number][];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
