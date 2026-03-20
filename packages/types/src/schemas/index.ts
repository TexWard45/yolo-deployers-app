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
  inReplyToExternalMessageId: z.string().optional(),
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
  externalThreadId: z.string().min(1).optional(),
  customerDisplayName: z.string().min(1),
  customerAvatarUrl: z.string().url().optional(),
  customerEmail: z.string().email().optional(),
  messageBody: z.string().min(1, "Message is required"),
  externalMessageId: z.string().optional(),
  inReplyToExternalMessageId: z.string().optional(),
  threadGroupingHint: z.string().optional(),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type IngestExternalMessageInput = z.infer<typeof IngestExternalMessageSchema>;

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
  status: ThreadStatusSchema.optional(),
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
  status: ThreadStatusSchema,
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

// ── Discord Channel Config ────────────────────────────────────────
export const DiscordChannelConfigSchema = z.object({
  channelIds: z.array(z.string()).min(1, "At least one channel ID required"),
  listenToThreads: z.boolean().optional().default(true),
});

export type DiscordChannelConfig = z.infer<typeof DiscordChannelConfigSchema>;

// ── Ingest Support Message (shared between bot, workflow, activity) ─
export const IngestSupportMessageInputSchema = z.object({
  channelConnectionId: z.string(),
  externalMessageId: z.string(),
  externalUserId: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  body: z.string(),
  timestamp: z.string(),
  rawPayload: z.record(z.string(), z.unknown()),
  externalThreadId: z.string().nullable(),
});

export type IngestSupportMessageInput = z.infer<typeof IngestSupportMessageInputSchema>;

// ── Thread Match Decision (deterministic + LLM fallback contract) ─
export const ThreadMatchStrategySchema = z.enum([
  "external_thread_id",
  "reply_chain",
  "fingerprint",
  "llm_fallback",
  "new_thread",
]);

export type ThreadMatchStrategy = z.infer<typeof ThreadMatchStrategySchema>;

export const ThreadMatchDecisionSchema = z.object({
  threadId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  strategy: ThreadMatchStrategySchema,
  issueFingerprint: z.string(),
  requiresReview: z.boolean(),
});

export type ThreadMatchDecision = z.infer<typeof ThreadMatchDecisionSchema>;

export const LlmThreadMatchInputSchema = z.object({
  incomingMessage: z.string().min(1),
  threadGroupingHint: z.string().optional(),
  candidates: z.array(
    z.object({
      id: z.string(),
      issueFingerprint: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
    }),
  ),
});

export type LlmThreadMatchInput = z.infer<typeof LlmThreadMatchInputSchema>;

export const LlmThreadMatchResultSchema = z.object({
  matchedThreadId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type LlmThreadMatchResult = z.infer<typeof LlmThreadMatchResultSchema>;

// ── Inbox Thread Resolution Workflow ──────────────────────────────
export const ResolveInboxThreadWorkflowInputSchema = z.object({
  workspaceId: z.string(),
  source: CustomerSourceSchema,
  customerId: z.string(),
  threadId: z.string(),
  messageId: z.string(),
  messageBody: z.string().min(1),
  issueFingerprint: z.string().min(1),
});

export type ResolveInboxThreadWorkflowInput = z.infer<
  typeof ResolveInboxThreadWorkflowInputSchema
>;

export const ResolveInboxThreadWorkflowResultSchema = z.object({
  applied: z.boolean(),
  matchedThreadId: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  reason: z.string(),
});

export type ResolveInboxThreadWorkflowResult = z.infer<
  typeof ResolveInboxThreadWorkflowResultSchema
>;
