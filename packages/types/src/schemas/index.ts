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

// ── Channel Connection ─────────────────────────────────────────────
export const CreateChannelConnectionSchema = z.object({
  workspaceId: z.string(),
  type: z.enum(["DISCORD", "IN_APP"]),
  name: z.string().min(1, "Connection name is required"),
  externalAccountId: z.string().optional(),
  configJson: z.record(z.string(), z.unknown()).optional(),
});

export type CreateChannelConnectionInput = z.infer<typeof CreateChannelConnectionSchema>;

export const UpdateChannelConnectionStatusSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  status: z.enum(["active", "inactive", "error"]),
});

export type UpdateChannelConnectionStatusInput = z.infer<typeof UpdateChannelConnectionStatusSchema>;

// ── Conversation ───────────────────────────────────────────────────
export const ListConversationsSchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  status: z.enum(["OPEN", "PENDING", "RESOLVED", "SPAM"]).optional(),
  channelType: z.enum(["DISCORD", "IN_APP"]).optional(),
  assignedToUserId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(25),
});

export type ListConversationsInput = z.infer<typeof ListConversationsSchema>;

export const UpdateConversationStatusSchema = z.object({
  conversationId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  status: z.enum(["OPEN", "PENDING", "RESOLVED", "SPAM"]),
});

export type UpdateConversationStatusInput = z.infer<typeof UpdateConversationStatusSchema>;

export const AssignConversationSchema = z.object({
  conversationId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  assignToUserId: z.string().nullable(),
});

export type AssignConversationInput = z.infer<typeof AssignConversationSchema>;

export const MergeCustomerIdentitySchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  sourceCustomerProfileId: z.string(),
  targetCustomerProfileId: z.string(),
});

export type MergeCustomerIdentityInput = z.infer<typeof MergeCustomerIdentitySchema>;

// ── Message ────────────────────────────────────────────────────────
export const ListMessagesByConversationSchema = z.object({
  conversationId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
});

export type ListMessagesByConversationInput = z.infer<typeof ListMessagesByConversationSchema>;

export const SendConversationReplySchema = z.object({
  conversationId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  body: z.string().min(1, "Reply body is required"),
});

export type SendConversationReplyInput = z.infer<typeof SendConversationReplySchema>;

// ── AI Agent ───────────────────────────────────────────────────────
export const GenerateReplyDraftSchema = z.object({
  conversationId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
});

export type GenerateReplyDraftInput = z.infer<typeof GenerateReplyDraftSchema>;

export const ApproveDraftSchema = z.object({
  draftId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
});

export type ApproveDraftInput = z.infer<typeof ApproveDraftSchema>;

export const DismissDraftSchema = z.object({
  draftId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
});

export type DismissDraftInput = z.infer<typeof DismissDraftSchema>;

export const UpdateWorkspaceAgentConfigSchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  enabled: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  tone: z.string().optional(),
  replyPolicy: z.string().optional(),
  autoDraftOnInbound: z.boolean().optional(),
  handoffRulesJson: z.record(z.string(), z.unknown()).optional(),
  model: z.string().optional(),
});

export type UpdateWorkspaceAgentConfigInput = z.infer<typeof UpdateWorkspaceAgentConfigSchema>;
