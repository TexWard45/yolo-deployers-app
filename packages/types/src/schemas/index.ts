import { z } from "zod";

// ── User ────────────────────────────────────────────────────────────
export const CreateUserSchema = z.object({
  username: z.string().min(3).max(32),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().nullable().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// ── Auth ────────────────────────────────────────────────────────────
export const LoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const SignupSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(32),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ── Workspace ───────────────────────────────────────────────────────
export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1, "Workspace name is required"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(32)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const AddWorkspaceMemberSchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
});

export type AddWorkspaceMemberInput = z.infer<typeof AddWorkspaceMemberSchema>;

// ── Post ────────────────────────────────────────────────────────────
export const CreatePostSchema = z.object({
  title: z.string().min(1),
  content: z.string().nullable().optional(),
  published: z.boolean().default(false),
  authorId: z.string(),
  workspaceId: z.string(),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;

// ── Inbox / Threads ────────────────────────────────────────────────
export const ThreadStatusSchema = z.enum([
  "NEW",
  "WAITING_REVIEW",
  "WAITING_CUSTOMER",
  "ESCALATED",
  "IN_PROGRESS",
  "CLOSED",
]);

export type ThreadStatusInput = z.infer<typeof ThreadStatusSchema>;

export const CustomerSourceSchema = z.enum(["DISCORD", "MANUAL", "API"]);

export type CustomerSourceInput = z.infer<typeof CustomerSourceSchema>;

export const MessageDirectionSchema = z.enum(["INBOUND", "OUTBOUND", "SYSTEM"]);

export type MessageDirectionInput = z.infer<typeof MessageDirectionSchema>;

export const ListThreadsSchema = z.object({
  workspaceId: z.string(),
  status: ThreadStatusSchema.optional(),
});

export type ListThreadsInput = z.infer<typeof ListThreadsSchema>;

export const GetThreadByIdSchema = z.object({
  threadId: z.string(),
});

export type GetThreadByIdInput = z.infer<typeof GetThreadByIdSchema>;

export const UpdateThreadStatusSchema = z.object({
  threadId: z.string(),
  status: ThreadStatusSchema,
});

export type UpdateThreadStatusInput = z.infer<typeof UpdateThreadStatusSchema>;

export const AssignThreadSchema = z.object({
  threadId: z.string(),
  assignedToId: z.string().nullable(),
});

export type AssignThreadInput = z.infer<typeof AssignThreadSchema>;

export const ListThreadMessagesSchema = z.object({
  threadId: z.string(),
});

export type ListThreadMessagesInput = z.infer<typeof ListThreadMessagesSchema>;

export const CreateOutgoingDraftSchema = z.object({
  threadId: z.string(),
  body: z.string().min(1, "Message body is required"),
});

export type CreateOutgoingDraftInput = z.infer<typeof CreateOutgoingDraftSchema>;

export const UpsertExternalCustomerSchema = z.object({
  workspaceId: z.string(),
  source: CustomerSourceSchema,
  externalCustomerId: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  email: z.string().email().optional(),
});

export type UpsertExternalCustomerInput = z.infer<typeof UpsertExternalCustomerSchema>;

export const UpsertExternalThreadSchema = z.object({
  workspaceId: z.string(),
  customerId: z.string(),
  source: CustomerSourceSchema,
  externalThreadId: z.string().min(1),
  title: z.string().optional(),
  status: ThreadStatusSchema.optional(),
});

export type UpsertExternalThreadInput = z.infer<typeof UpsertExternalThreadSchema>;

export const IngestExternalMessageSchema = z.object({
  workspaceId: z.string(),
  source: CustomerSourceSchema,
  externalCustomerId: z.string().min(1),
  externalThreadId: z.string().min(1),
  customerDisplayName: z.string().min(1),
  customerAvatarUrl: z.string().url().optional(),
  customerEmail: z.string().email().optional(),
  messageBody: z.string().min(1, "Message is required"),
  externalMessageId: z.string().optional(),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type IngestExternalMessageInput = z.infer<typeof IngestExternalMessageSchema>;
