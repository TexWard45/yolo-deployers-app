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

// ── Codex ──────────────────────────────────────────────────────────
export * from "./codex";

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

// ── AI Agent ───────────────────────────────────────────────────────
export const GenerateReplyDraftSchema = z.object({
  threadId: z.string(),
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
  autoReply: z.boolean().optional(),
  handoffRulesJson: z.record(z.string(), z.unknown()).optional(),
  model: z.string().optional(),
  // Analysis pipeline settings
  analysisEnabled: z.boolean().optional(),
  maxClarifications: z.number().int().min(0).max(10).optional(),
  codexRepositoryIds: z.array(z.string()).optional(),
  // Sentry integration
  sentryDsn: z.string().optional(),
  sentryOrgSlug: z.string().optional(),
  sentryProjectSlug: z.string().optional(),
  sentryAuthToken: z.string().optional(),
  // Linear integration
  linearApiKey: z.string().optional(),
  linearTeamId: z.string().optional(),
  linearDefaultLabels: z.array(z.string()).optional(),
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
  inReplyToExternalMessageId: z.string().nullable().optional(),
});

export type IngestSupportMessageInput = z.infer<typeof IngestSupportMessageInputSchema>;

// ── Thread Match Decision ─────────────────────────────────────────
export const ThreadMatchStrategySchema = z.enum([
  "external_thread_id",
  "reply_chain",
  "time_proximity",
  "new_thread",
]);

export type ThreadMatchStrategy = z.infer<typeof ThreadMatchStrategySchema>;

export const ThreadMatchDecisionSchema = z.object({
  threadId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  strategy: ThreadMatchStrategySchema,
  issueFingerprint: z.string(),
});

export type ThreadMatchDecision = z.infer<typeof ThreadMatchDecisionSchema>;

// ── Thread Review Workflow (group first, eject later) ─────────────
export const ThreadReviewWorkflowInputSchema = z.object({
  workspaceId: z.string(),
  source: CustomerSourceSchema,
  threadId: z.string(),
});

export type ThreadReviewWorkflowInput = z.infer<typeof ThreadReviewWorkflowInputSchema>;

export const ThreadReviewEjectionSchema = z.object({
  messageId: z.string(),
  reason: z.string(),
  targetThreadId: z.string().nullable(),
});

export type ThreadReviewEjection = z.infer<typeof ThreadReviewEjectionSchema>;

export const ThreadReviewResultSchema = z.object({
  verdict: z.enum(["keep_all", "eject"]),
  ejections: z.array(ThreadReviewEjectionSchema),
});

export type ThreadReviewResult = z.infer<typeof ThreadReviewResultSchema>;

export const ThreadReviewWorkflowResultSchema = z.object({
  reviewed: z.boolean(),
  verdict: z.enum(["keep_all", "eject", "skipped"]),
  ejectionsApplied: z.number(),
  reason: z.string(),
});

export type ThreadReviewWorkflowResult = z.infer<typeof ThreadReviewWorkflowResultSchema>;

// ── Tracker Integration ──────────────────────────────────────────
export const TrackerTypeSchema = z.enum(["LINEAR", "JIRA"]);
export type TrackerTypeValue = z.infer<typeof TrackerTypeSchema>;

export const CreateTrackerConnectionSchema = z.object({
  workspaceId: z.string(),
  type: TrackerTypeSchema,
  label: z.string().min(1).max(100),
  apiToken: z.string().min(1),
  projectKey: z.string().min(1),
  projectName: z.string().min(1),
  siteUrl: z.string().url().optional(),
  configJson: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});
export type CreateTrackerConnectionInput = z.infer<typeof CreateTrackerConnectionSchema>;

export const UpdateTrackerConnectionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  label: z.string().min(1).max(100).optional(),
  projectKey: z.string().min(1).optional(),
  projectName: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  configJson: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateTrackerConnectionInput = z.infer<typeof UpdateTrackerConnectionSchema>;

export const DeleteTrackerConnectionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
});
export type DeleteTrackerConnectionInput = z.infer<typeof DeleteTrackerConnectionSchema>;

export const ListTrackerConnectionsSchema = z.object({
  workspaceId: z.string(),
});
export type ListTrackerConnectionsInput = z.infer<typeof ListTrackerConnectionsSchema>;

export const ListTrackerProjectsSchema = z.object({
  type: TrackerTypeSchema,
  apiToken: z.string().min(1),
  siteUrl: z.string().url().optional(),
});
export type ListTrackerProjectsInput = z.infer<typeof ListTrackerProjectsSchema>;

// ── Legacy types kept for existing activity imports ───────────────
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

// ── Thread Analysis Pipeline ────────────────────────────────────────

export const DraftTypeSchema = z.enum(["RESOLUTION", "CLARIFICATION", "MANUAL"]);
export type DraftTypeValue = z.infer<typeof DraftTypeSchema>;

export const AnalyzeThreadWorkflowInputSchema = z.object({
  workspaceId: z.string(),
  threadId: z.string(),
  source: CustomerSourceSchema,
  triggeredByMessageId: z.string(),
});
export type AnalyzeThreadWorkflowInput = z.infer<typeof AnalyzeThreadWorkflowInputSchema>;

export const AnalyzeThreadWorkflowResultSchema = z.object({
  analysisId: z.string().nullable(),
  draftId: z.string().nullable(),
  action: z.enum(["clarification", "resolution", "escalated", "skipped"]),
  reason: z.string().optional(),
});
export type AnalyzeThreadWorkflowResult = z.infer<typeof AnalyzeThreadWorkflowResultSchema>;

export const SufficiencyCheckResultSchema = z.object({
  sufficient: z.boolean(),
  missingContext: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type SufficiencyCheckResult = z.infer<typeof SufficiencyCheckResultSchema>;

export const ThreadAnalysisResultSchema = z.object({
  issueCategory: z.string().nullable(),
  severity: z.string().nullable(),
  affectedComponent: z.string().nullable(),
  summary: z.string(),
  rcaSummary: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ThreadAnalysisResult = z.infer<typeof ThreadAnalysisResultSchema>;

export const DraftReplyResultSchema = z.object({
  body: z.string(),
  confidence: z.number().min(0).max(1),
});
export type DraftReplyResult = z.infer<typeof DraftReplyResultSchema>;

export const SaveAnalysisInputSchema = z.object({
  workspaceId: z.string(),
  threadId: z.string(),
  analysis: z.object({
    issueCategory: z.string().nullable(),
    severity: z.string().nullable(),
    affectedComponent: z.string().nullable(),
    summary: z.string(),
    codexFindings: z.unknown().nullable(),
    sentryFindings: z.unknown().nullable(),
    rcaSummary: z.string().nullable(),
    sufficient: z.boolean(),
    missingContext: z.array(z.string()),
    model: z.string().nullable(),
    promptVersion: z.string().nullable(),
    totalTokens: z.number().nullable(),
    durationMs: z.number().nullable(),
  }),
  draft: z.object({
    body: z.string(),
    draftType: DraftTypeSchema,
    basedOnMessageId: z.string().optional(),
    model: z.string().nullable(),
  }),
});
export type SaveAnalysisInput = z.infer<typeof SaveAnalysisInputSchema>;

export const TriggerAnalysisInputSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
});
export type TriggerAnalysisInput = z.infer<typeof TriggerAnalysisInputSchema>;

export const GetLatestAnalysisInputSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
});
export type GetLatestAnalysisInput = z.infer<typeof GetLatestAnalysisInputSchema>;

// ── Triage Pipeline ────────────────────────────────────────────────────

export const TriageToLinearSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  analysisId: z.string(),
  overrides: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    severity: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
    labels: z.array(z.string()).optional(),
  }).optional(),
});
export type TriageToLinearInput = z.infer<typeof TriageToLinearSchema>;

export const GetTriageStatusSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
});
export type GetTriageStatusInput = z.infer<typeof GetTriageStatusSchema>;

export const GenerateSpecSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  linearIssueId: z.string().optional(),
});
export type GenerateSpecInput = z.infer<typeof GenerateSpecSchema>;

// ── Triage Workflow (Temporal) ─────────────────────────────────────

export const TriageThreadWorkflowInputSchema = z.object({
  workspaceId: z.string(),
  threadId: z.string(),
  analysisId: z.string(),
  triggeredByUserId: z.string(),
});
export type TriageThreadWorkflowInput = z.infer<typeof TriageThreadWorkflowInputSchema>;

export const TriageThreadWorkflowResultSchema = z.object({
  linearIssueId: z.string().nullable(),
  linearIssueUrl: z.string().nullable(),
  specMarkdown: z.string().nullable(),
  action: z.enum(["triaged", "spec_generated", "skipped", "failed"]),
  reason: z.string().optional(),
});
export type TriageThreadWorkflowResult = z.infer<typeof TriageThreadWorkflowResultSchema>;

// ── Support Pipeline Master Workflow (Temporal) ────────────────────

export const SupportPipelineWorkflowInputSchema = z.object({
  workspaceId: z.string(),
  threadId: z.string(),
  source: CustomerSourceSchema,
  triggeredByMessageId: z.string(),
});
export type SupportPipelineWorkflowInput = z.infer<typeof SupportPipelineWorkflowInputSchema>;

export const SupportPipelinePhaseSchema = z.enum([
  "gate_1_investigate",
  "phase_1_context",
  "phase_2_investigate",
  "phase_3_analyze",
  "gate_2_triage",
  "phase_4_triage",
  "gate_3_spec",
  "phase_5_spec",
  "done",
]);
export type SupportPipelinePhase = z.infer<typeof SupportPipelinePhaseSchema>;

export const SupportPipelineWorkflowResultSchema = z.object({
  phase: SupportPipelinePhaseSchema,
  analysisId: z.string().nullable(),
  draftId: z.string().nullable(),
  linearIssueId: z.string().nullable(),
  linearIssueUrl: z.string().nullable(),
  specMarkdown: z.string().nullable(),
  reason: z.string().optional(),
});
export type SupportPipelineWorkflowResult = z.infer<typeof SupportPipelineWorkflowResultSchema>;
