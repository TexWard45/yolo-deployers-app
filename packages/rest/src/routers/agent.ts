import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure, type TRPCContext } from "../init";
import {
  UpdateWorkspaceAgentConfigSchema,
  GenerateReplyDraftSchema,
  ApproveDraftSchema,
  DismissDraftSchema,
  GetLatestAnalysisInputSchema,
  TriggerAnalysisInputSchema,
  SaveAnalysisInputSchema,
  TriageToLinearSchema,
  GetTriageStatusSchema,
  GenerateSpecSchema,
  GenerateFixPRSchema,
  GetFixPRStatusSchema,
  CancelFixPRSchema,
  SaveFixPRProgressSchema,
  TestSentryConnectionSchema,
} from "@shared/types";
import type { SaveFixPRProgressInput } from "@shared/types";
import type { Prisma } from "@shared/types/prisma";
import {
  dispatchAnalyzeThreadWorkflow,
  dispatchGenerateFixPRWorkflow,
  cancelGenerateFixPRWorkflow,
} from "../temporal";
import { sendDraftToChannel } from "./helpers/send-draft";
import { testSentryConnection as testSentryConnectionFn } from "./helpers/sentry-client";
import {
  createLinearClient,
  createLinearIssue,
  updateLinearIssue,
  getLinearIssue,
  severityToPriority,
} from "./helpers/linear-client";
import { generateLinearIssueBody, generateEngSpec } from "./helpers/triage-spec.prompt";
import type { TriagePromptInput } from "./helpers/triage-spec.prompt";

const ACTIVE_FIX_PR_STATUSES = new Set(["QUEUED", "RUNNING"]);
const TERMINAL_FIX_PR_STATUSES = new Set(["PASSED", "WAITING_REVIEW", "FAILED", "CANCELLED"]);
const ADMIN_WORKSPACE_ROLES = new Set(["OWNER", "ADMIN"]);
const REDACTED_SECRET_PLACEHOLDER = "***";

async function requireWorkspaceMember(
  ctx: TRPCContext,
  input: { workspaceId: string; userId: string },
  allowedRoles?: Set<string>,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: input.userId,
        workspaceId: input.workspaceId,
      },
    },
  });

  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
  }

  if (allowedRoles && !allowedRoles.has(member.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only OWNER or ADMIN can configure AI agent",
    });
  }

  return member;
}

function getDefaultWorkspaceAgentConfig(workspaceId: string) {
  return {
    id: null,
    workspaceId,
    enabled: false,
    systemPrompt: null,
    tone: null,
    replyPolicy: null,
    autoDraftOnInbound: true,
    autoReply: false,
    handoffRulesJson: null,
    model: null,
    analysisEnabled: true,
    maxClarifications: 2,
    codexRepositoryIds: [] as string[],
    sentryDsn: null,
    sentryOrgSlug: null,
    sentryProjectSlug: null,
    sentryAuthToken: null,
    linearApiKey: null,
    linearTeamId: null,
    linearDefaultLabels: [] as string[],
    sentryProjectSlugs: [] as string[],
    investigationABEnabled: false,
    githubToken: null,
    githubDefaultOwner: null,
    githubDefaultRepo: null,
    githubBaseBranch: "main",
    codexFixModel: null,
    codexReviewModel: null,
    codexFixMaxIterations: 3,
    codexRequiredCheckNames: [] as string[],
    threadRecencyWindowMinutes: 0,
    createdAt: null,
    updatedAt: null,
  };
}

function buildWorkspaceAgentConfigUpdateData(input: Omit<z.infer<typeof UpdateWorkspaceAgentConfigSchema>, "workspaceId" | "userId">) {
  const {
    handoffRulesJson,
    githubToken,
    sentryAuthToken,
    linearApiKey,
    ...rest
  } = input;

  return {
    ...rest,
    ...(handoffRulesJson !== undefined
      ? { handoffRulesJson: handoffRulesJson as Record<string, unknown> as never }
      : {}),
    ...(githubToken !== REDACTED_SECRET_PLACEHOLDER ? { githubToken } : {}),
    ...(sentryAuthToken !== REDACTED_SECRET_PLACEHOLDER ? { sentryAuthToken } : {}),
    ...(linearApiKey !== REDACTED_SECRET_PLACEHOLDER ? { linearApiKey } : {}),
  };
}

function buildFixPrRunMetadata(config: {
  githubToken?: string | null;
  githubDefaultOwner?: string | null;
  githubDefaultRepo?: string | null;
} | null): Prisma.InputJsonValue {
  return {
    githubConfigured: Boolean(config?.githubToken && config.githubDefaultOwner && config.githubDefaultRepo),
  };
}

function serializeFixPrStatus(run: {
  id: string;
  status: string;
  currentStage: string;
  parentThreadId: string | null;
  iterationCount: number;
  maxIterations: number;
  summary: string | null;
  lastError: string | null;
  prUrl: string | null;
  prNumber: number | null;
  branchName: string | null;
  rcaSummary: string | null;
  rcaConfidence: number | null;
  iterations: Array<{
    id: string;
    iteration: number;
    status: string;
    fixPlan: unknown;
    reviewFindings: unknown;
    checkResults: unknown;
    appliedFiles: unknown;
    startedAt: Date;
    completedAt: Date | null;
  }>;
}) {
  return {
    runId: run.id,
    status: run.status,
    currentStage: run.currentStage,
    parentThreadId: run.parentThreadId,
    iterationCount: run.iterationCount,
    maxIterations: run.maxIterations,
    summary: run.summary,
    lastError: run.lastError,
    prUrl: run.prUrl,
    prNumber: run.prNumber,
    branchName: run.branchName,
    rcaSummary: run.rcaSummary,
    rcaConfidence: run.rcaConfidence,
    iterations: run.iterations.map((iteration) => ({
      id: iteration.id,
      iteration: iteration.iteration,
      status: iteration.status,
      fixPlan: iteration.fixPlan,
      reviewFindings: iteration.reviewFindings,
      checkResults: iteration.checkResults,
      appliedFiles: iteration.appliedFiles,
      startedAt: iteration.startedAt.toISOString(),
      completedAt: iteration.completedAt?.toISOString() ?? null,
    })),
  };
}

function toOptionalJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}

function buildFixPrRunUpdateData(input: SaveFixPRProgressInput): Prisma.FixPrRunUpdateInput {
  return {
    ...(input.status ? { status: input.status } : {}),
    ...(input.currentStage ? { currentStage: input.currentStage } : {}),
    ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    ...(input.branchName !== undefined ? { branchName: input.branchName } : {}),
    ...(input.prUrl !== undefined ? { prUrl: input.prUrl } : {}),
    ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
    ...(input.headSha !== undefined ? { headSha: input.headSha } : {}),
    ...(input.rcaSummary !== undefined ? { rcaSummary: input.rcaSummary } : {}),
    ...(input.rcaConfidence !== undefined ? { rcaConfidence: input.rcaConfidence } : {}),
    ...(input.rcaSignals !== undefined ? { rcaSignals: toOptionalJsonValue(input.rcaSignals) } : {}),
    ...(input.metadata !== undefined ? { metadata: toOptionalJsonValue(input.metadata) } : {}),
    ...(input.incrementIterationCount ? { iterationCount: { increment: 1 } } : {}),
  };
}

function buildFixPrIterationUpsertData(
  runId: string,
  iteration: NonNullable<SaveFixPRProgressInput["iteration"]>,
) {
  const sharedData = {
    status: iteration.status,
    fixPlan: toOptionalJsonValue(iteration.fixPlan),
    reviewFindings: toOptionalJsonValue(iteration.reviewFindings),
    checkResults: toOptionalJsonValue(iteration.checkResults),
    appliedFiles: toOptionalJsonValue(iteration.appliedFiles),
    completedAt: iteration.completed ? new Date() : undefined,
  };

  return {
    where: {
      runId_iteration: {
        runId,
        iteration: iteration.iteration,
      },
    },
    create: {
      runId,
      iteration: iteration.iteration,
      ...sharedData,
    },
    update: sharedData,
  };
}

async function createTerminalFixPrTriageAction(
  ctx: TRPCContext,
  params: {
    run: {
      id: string;
      analysisId: string;
      threadId: string;
      workspaceId: string;
      createdById: string;
      prUrl: string | null;
      currentStage: string;
    };
    input: SaveFixPRProgressInput;
  },
): Promise<void> {
  if (!params.input.status || !TERMINAL_FIX_PR_STATUSES.has(params.input.status)) {
    return;
  }

  const existingAction = await ctx.prisma.triageAction.findFirst({
    where: {
      analysisId: params.run.analysisId,
      action: "GENERATE_FIX_PR",
    },
  });

  if (existingAction) {
    return;
  }

  await ctx.prisma.triageAction.create({
    data: {
      threadId: params.run.threadId,
      workspaceId: params.run.workspaceId,
      analysisId: params.run.analysisId,
      action: "GENERATE_FIX_PR",
      prUrl: params.input.prUrl ?? params.run.prUrl,
      metadata: {
        runId: params.run.id,
        status: params.input.status,
        currentStage: params.input.currentStage ?? params.run.currentStage,
      } as Prisma.InputJsonValue,
      createdById: params.run.createdById,
    },
  });
}

export const agentRouter = createTRPCRouter({
  /** Get workspace AI agent config */
  getWorkspaceConfig: publicProcedure
    .input(z.object({ workspaceId: z.string(), userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireWorkspaceMember(ctx, input);

      const config = await ctx.prisma.workspaceAgentConfig.findUnique({
        where: { workspaceId: input.workspaceId },
      });

      if (config) {
        return {
          ...config,
          sentryAuthToken: config.sentryAuthToken ? "***" : null,
          linearApiKey: config.linearApiKey ? "***" : null,
          githubToken: config.githubToken ? "***" : null,
        };
      }
      return getDefaultWorkspaceAgentConfig(input.workspaceId);
    }),

  /** Update workspace AI agent config (OWNER/ADMIN only) */
  updateWorkspaceConfig: publicProcedure
    .input(UpdateWorkspaceAgentConfigSchema)
    .mutation(async ({ ctx, input }) => {
      await requireWorkspaceMember(ctx, input, ADMIN_WORKSPACE_ROLES);

      const { workspaceId, userId, ...rest } = input;
      const data = buildWorkspaceAgentConfigUpdateData(rest);

      return ctx.prisma.workspaceAgentConfig.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data,
      });
    }),

  /** Test Sentry API connection with provided credentials */
  testSentryConnection: publicProcedure
    .input(TestSentryConnectionSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only OWNER or ADMIN can test Sentry connection" });
      }

      return testSentryConnectionFn(
        input.sentryOrgSlug,
        input.sentryProjectSlug,
        input.sentryAuthToken,
      );
    }),

  /** Generate an AI draft reply for a thread */
  generateDraft: publicProcedure
    .input(GenerateReplyDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      const thread = await ctx.prisma.supportThread.findFirst({
        where: { id: input.threadId, workspaceId: input.workspaceId },
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 10 },
          customer: true,
        },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      const lastMessage = thread.messages[0];

      const draft = await ctx.prisma.replyDraft.create({
        data: {
          threadId: input.threadId,
          basedOnMessageId: lastMessage?.id,
          createdByUserId: input.userId,
          status: "GENERATED",
          body: "",
          model: null,
          promptVersion: null,
        },
      });

      // TODO: Trigger generate-reply-draft workflow via Temporal
      // For now, generate a simple placeholder
      const threadContext = thread.messages
        .reverse()
        .map((m) => `${m.direction}: ${m.body}`)
        .join("\n");

      const draftBody = `[AI Draft] Based on the conversation:\n${threadContext}\n\nSuggested reply: Thank you for reaching out. I'd be happy to help with your question.`;

      const updatedDraft = await ctx.prisma.replyDraft.update({
        where: { id: draft.id },
        data: { body: draftBody },
      });

      return updatedDraft;
    }),

  /** Approve a draft, send to channel, and record outbound message */
  approveDraft: publicProcedure
    .input(ApproveDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      const draft = await ctx.prisma.replyDraft.findUnique({
        where: { id: input.draftId },
        include: {
          thread: {
            include: {
              messages: {
                where: { direction: "INBOUND" },
                orderBy: { createdAt: "asc" },
                take: 1,
                select: { metadata: true, externalMessageId: true, body: true },
              },
            },
          },
        },
      });

      if (!draft || draft.thread.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      if (draft.status !== "GENERATED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Draft is not in GENERATED state" });
      }

      const firstInbound = draft.thread.messages[0] ?? null;

      await sendDraftToChannel(ctx.prisma, {
        draftId: input.draftId,
        draftBody: draft.body,
        threadId: draft.threadId,
        threadSource: draft.thread.source,
        externalThreadId: draft.thread.externalThreadId,
        firstInbound: firstInbound
          ? { metadata: firstInbound.metadata, externalMessageId: firstInbound.externalMessageId, body: firstInbound.body }
          : null,
        metadataSource: "ai-draft-approved",
      });

      return ctx.prisma.replyDraft.findUniqueOrThrow({ where: { id: input.draftId } });
    }),

  /** Dismiss a draft */
  dismissDraft: publicProcedure
    .input(DismissDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      const draft = await ctx.prisma.replyDraft.findUnique({
        where: { id: input.draftId },
        include: { thread: true },
      });

      if (!draft || draft.thread.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      return ctx.prisma.replyDraft.update({
        where: { id: input.draftId },
        data: { status: "DISMISSED" },
      });
    }),

  /** Get the latest analysis for a thread */
  getLatestAnalysis: publicProcedure
    .input(GetLatestAnalysisInputSchema)
    .query(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      const thread = await ctx.prisma.supportThread.findFirst({
        where: { id: input.threadId, workspaceId: input.workspaceId },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      return ctx.prisma.threadAnalysis.findFirst({
        where: { threadId: input.threadId, workspaceId: input.workspaceId },
        orderBy: { createdAt: "desc" },
        include: {
          drafts: {
            where: { status: "GENERATED" },
            take: 1,
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }),

  /** Manually trigger analysis pipeline for a thread */
  triggerAnalysis: publicProcedure
    .input(TriggerAnalysisInputSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      const thread = await ctx.prisma.supportThread.findFirst({
        where: { id: input.threadId, workspaceId: input.workspaceId },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      await dispatchAnalyzeThreadWorkflow({
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        source: thread.source,
        triggeredByMessageId: "manual-trigger",
      });

      return { triggered: true };
    }),

  /** Save analysis + draft (called by queue worker via REST) */
  saveAnalysis: publicProcedure
    .input(SaveAnalysisInputSchema)
    .mutation(async ({ ctx, input }) => {
      const analysis = await ctx.prisma.threadAnalysis.create({
        data: {
          threadId: input.threadId,
          workspaceId: input.workspaceId,
          issueCategory: input.analysis.issueCategory,
          severity: input.analysis.severity,
          affectedComponent: input.analysis.affectedComponent,
          summary: input.analysis.summary,
          codexFindings: input.analysis.codexFindings as Prisma.InputJsonValue ?? undefined,
          sentryFindings: input.analysis.sentryFindings as Prisma.InputJsonValue ?? undefined,
          rcaSummary: input.analysis.rcaSummary,
          sufficient: input.analysis.sufficient,
          missingContext: input.analysis.missingContext,
          model: input.analysis.model,
          promptVersion: input.analysis.promptVersion,
          totalTokens: input.analysis.totalTokens,
          durationMs: input.analysis.durationMs,
        },
      });

      const draft = await ctx.prisma.replyDraft.create({
        data: {
          threadId: input.threadId,
          status: "GENERATED",
          draftType: input.draft.draftType,
          body: input.draft.body,
          model: input.draft.model,
          analysisId: analysis.id,
          basedOnMessageId: input.draft.basedOnMessageId,
        },
      });

      // Update thread with latest analysis + summary + AI label + increment clarification count if needed
      const updateData: Record<string, unknown> = {
        lastAnalysisId: analysis.id,
        summary: input.analysis.summary,
        summaryUpdatedAt: new Date(),
      };
      if (input.analysis.threadLabel) {
        updateData.title = input.analysis.threadLabel;
      }
      if (input.draft.draftType === "CLARIFICATION") {
        updateData.clarificationCount = { increment: 1 };
      }

      await ctx.prisma.supportThread.update({
        where: { id: input.threadId },
        data: updateData,
      });

      // Auto-reply: if workspace has autoReply enabled, send the draft immediately
      const agentConfig = await ctx.prisma.workspaceAgentConfig.findUnique({
        where: { workspaceId: input.workspaceId },
        select: { autoReply: true },
      });

      if (agentConfig?.autoReply) {
        console.log(`[saveAnalysis] autoReply enabled — auto-sending draft ${draft.id}`);

        const thread = await ctx.prisma.supportThread.findUnique({
          where: { id: input.threadId },
          include: {
            messages: {
              where: { direction: "INBOUND" },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { metadata: true, externalMessageId: true, body: true },
            },
          },
        });

        if (thread) {
          const firstInbound = thread.messages[0] ?? null;
          await sendDraftToChannel(ctx.prisma, {
            draftId: draft.id,
            draftBody: draft.body,
            threadId: input.threadId,
            threadSource: thread.source,
            externalThreadId: thread.externalThreadId,
            firstInbound: firstInbound
              ? { metadata: firstInbound.metadata, externalMessageId: firstInbound.externalMessageId, body: firstInbound.body }
              : null,
            metadataSource: "ai-auto-reply",
          });
        }
      }

      return { analysisId: analysis.id, draftId: draft.id };
    }),

  /** Triage thread to Linear — create or update a Linear issue */
  triageToLinear: publicProcedure
    .input(TriageToLinearSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      // Fetch workspace config for Linear credentials
      const config = await ctx.prisma.workspaceAgentConfig.findUnique({
        where: { workspaceId: input.workspaceId },
      });

      if (!config?.linearApiKey || !config.linearTeamId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Linear not configured for this workspace. Add API key and team ID in settings.",
        });
      }

      // Fetch analysis
      const analysis = await ctx.prisma.threadAnalysis.findUnique({
        where: { id: input.analysisId },
        include: { thread: { include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } } } },
      });

      if (!analysis || analysis.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Analysis not found" });
      }

      const thread = analysis.thread;
      const client = createLinearClient(config.linearApiKey);

      // Build triage prompt input
      const promptInput: TriagePromptInput = {
        analysis: {
          issueCategory: analysis.issueCategory,
          severity: analysis.severity,
          affectedComponent: analysis.affectedComponent,
          summary: analysis.summary,
          rcaSummary: analysis.rcaSummary,
          codexFindings: analysis.codexFindings,
          sentryFindings: analysis.sentryFindings,
        },
        messages: thread.messages.map((m) => ({ direction: m.direction, body: m.body })),
        customerDisplayName: "Customer",
        threadTitle: thread.title,
      };

      // Generate Linear issue body via LLM
      const llmApiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
      const generated = llmApiKey
        ? await generateLinearIssueBody(promptInput, { apiKey: llmApiKey, model: config.model ?? undefined })
        : null;

      const title = input.overrides?.title ?? generated?.title ?? analysis.summary.slice(0, 100);
      const description = input.overrides?.description ?? generated?.description ?? analysis.summary;
      const priority = severityToPriority(input.overrides?.severity ?? analysis.severity);
      const labelNames = input.overrides?.labels ?? config.linearDefaultLabels;

      let action: "created" | "updated";
      let linearResult: { id: string; identifier: string; url: string };

      if (thread.linearIssueId) {
        // Check if existing issue still exists
        const existing = await getLinearIssue(client, thread.linearIssueId);
        if (existing) {
          linearResult = await updateLinearIssue(client, thread.linearIssueId, {
            title,
            description,
            priority,
          });
          action = "updated";
        } else {
          // Issue was deleted externally — re-create
          linearResult = await createLinearIssue(client, {
            teamId: config.linearTeamId,
            title,
            description,
            priority,
            labelNames: labelNames.length > 0 ? labelNames : undefined,
          });
          action = "created";
        }
      } else {
        linearResult = await createLinearIssue(client, {
          teamId: config.linearTeamId,
          title,
          description,
          priority,
          labelNames: labelNames.length > 0 ? labelNames : undefined,
        });
        action = "created";
      }

      // Save to thread
      await ctx.prisma.supportThread.update({
        where: { id: thread.id },
        data: {
          linearIssueId: linearResult.id,
          linearIssueUrl: linearResult.url,
        },
      });

      // Audit log
      await ctx.prisma.triageAction.create({
        data: {
          threadId: thread.id,
          workspaceId: input.workspaceId,
          analysisId: input.analysisId,
          action: action === "created" ? "CREATE_TICKET" : "UPDATE_TICKET",
          linearIssueId: linearResult.identifier,
          linearIssueUrl: linearResult.url,
          createdById: input.userId,
        },
      });

      return {
        linearIssueId: linearResult.identifier,
        linearIssueUrl: linearResult.url,
        action,
      };
    }),

  /** Get triage status + history for a thread */
  getTriageStatus: publicProcedure
    .input(GetTriageStatusSchema)
    .query(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      const thread = await ctx.prisma.supportThread.findFirst({
        where: { id: input.threadId, workspaceId: input.workspaceId },
        select: {
          linearIssueId: true,
          linearIssueUrl: true,
        },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      const history = await ctx.prisma.triageAction.findMany({
        where: { threadId: input.threadId, workspaceId: input.workspaceId },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { createdBy: { select: { username: true } } },
      });

      return {
        linearIssueId: thread.linearIssueId,
        linearIssueUrl: thread.linearIssueUrl,
        history: history.map((h) => ({
          id: h.id,
          action: h.action,
          linearIssueId: h.linearIssueId,
          linearIssueUrl: h.linearIssueUrl,
          prUrl: h.prUrl,
          specMarkdown: h.specMarkdown,
          createdBy: h.createdBy.username,
          createdAt: h.createdAt.toISOString(),
        })),
      };
    }),

  generateFixPR: publicProcedure
    .input(GenerateFixPRSchema)
    .mutation(async ({ ctx, input }) => {
      await requireWorkspaceMember(ctx, input);

      const analysis = await ctx.prisma.threadAnalysis.findUnique({
        where: { id: input.analysisId },
        include: { thread: true },
      });

      if (!analysis || analysis.workspaceId !== input.workspaceId || analysis.threadId !== input.threadId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Analysis not found" });
      }

      const config = await ctx.prisma.workspaceAgentConfig.findUnique({
        where: { workspaceId: input.workspaceId },
      });

      const existingRun = await ctx.prisma.fixPrRun.findUnique({
        where: { analysisId: input.analysisId },
      });

      if (existingRun) {
        if (ACTIVE_FIX_PR_STATUSES.has(existingRun.status)) {
          return {
            runId: existingRun.id,
            status: existingRun.status,
            alreadyRunning: true,
          };
        }

        // Terminal state — reset and re-run
        await ctx.prisma.fixPrRun.update({
          where: { id: existingRun.id },
          data: {
            status: "QUEUED",
            currentStage: "QUEUED",
            summary: null,
            lastError: null,
            maxIterations: config?.codexFixMaxIterations ?? 3,
          },
        });

        await dispatchGenerateFixPRWorkflow({
          runId: existingRun.id,
          threadId: input.threadId,
          workspaceId: input.workspaceId,
          analysisId: input.analysisId,
          triggeredByUserId: input.userId,
        });

        return {
          runId: existingRun.id,
          status: "QUEUED",
          alreadyRunning: false,
        };
      }

      const run = await ctx.prisma.fixPrRun.create({
        data: {
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          analysisId: input.analysisId,
          createdById: input.userId,
          status: "QUEUED",
          currentStage: "QUEUED",
          maxIterations: config?.codexFixMaxIterations ?? 3,
          metadata: buildFixPrRunMetadata(config),
        },
      });

      await dispatchGenerateFixPRWorkflow({
        runId: run.id,
        threadId: input.threadId,
        workspaceId: input.workspaceId,
        analysisId: input.analysisId,
        triggeredByUserId: input.userId,
      });

      return {
        runId: run.id,
        status: run.status,
        alreadyRunning: false,
      };
    }),

  getFixPRStatus: publicProcedure
    .input(GetFixPRStatusSchema)
    .query(async ({ ctx, input }) => {
      await requireWorkspaceMember(ctx, input);

      const run = await ctx.prisma.fixPrRun.findFirst({
        where: {
          threadId: input.threadId,
          workspaceId: input.workspaceId,
        },
        orderBy: { createdAt: "desc" },
        include: {
          iterations: {
            orderBy: { iteration: "desc" },
            take: 10,
          },
        },
      });

      if (!run) return null;

      return serializeFixPrStatus(run);
    }),

  cancelFixPR: publicProcedure
    .input(CancelFixPRSchema)
    .mutation(async ({ ctx, input }) => {
      await requireWorkspaceMember(ctx, input);

      const run = await ctx.prisma.fixPrRun.findUnique({
        where: { id: input.runId },
      });

      if (!run || run.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Fix run not found" });
      }

      await ctx.prisma.fixPrRun.update({
        where: { id: input.runId },
        data: {
          status: "CANCELLED",
          currentStage: "CANCELLED",
        },
      });

      await cancelGenerateFixPRWorkflow(run.analysisId);

      return { cancelled: true };
    }),

  saveFixPRProgress: publicProcedure
    .input(SaveFixPRProgressSchema)
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.prisma.fixPrRun.findUnique({
        where: { id: input.runId },
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Fix run not found" });
      }

      await ctx.prisma.fixPrRun.update({
        where: { id: input.runId },
        data: buildFixPrRunUpdateData(input),
      });

      if (input.iteration) {
        await ctx.prisma.fixPrIteration.upsert(buildFixPrIterationUpsertData(input.runId, input.iteration));
      }

      await createTerminalFixPrTriageAction(ctx, { run, input });

      return { saved: true };
    }),

  /** Generate an engineering spec from the analysis */
  generateSpec: publicProcedure
    .input(GenerateSpecSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      // Get latest analysis for the thread
      const analysis = await ctx.prisma.threadAnalysis.findFirst({
        where: { threadId: input.threadId, workspaceId: input.workspaceId },
        orderBy: { createdAt: "desc" },
        include: { thread: { include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } } } },
      });

      if (!analysis) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No analysis found for this thread" });
      }

      const config = await ctx.prisma.workspaceAgentConfig.findUnique({
        where: { workspaceId: input.workspaceId },
      });

      const llmApiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
      if (!llmApiKey) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LLM API key not configured" });
      }

      // Fresh Codex search using analysis summary + RCA as query
      let freshCodexFindings = analysis.codexFindings;
      const repoIds = config?.codexRepositoryIds ?? [];
      if (repoIds.length > 0) {
        const searchQuery = [
          analysis.summary,
          analysis.rcaSummary,
          analysis.affectedComponent,
        ].filter(Boolean).join(" ");

        try {
          const webAppUrl = process.env.WEB_APP_URL ?? "http://localhost:3000";
          const searchResponse = await fetch(`${webAppUrl}/api/rest/codex/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId: input.workspaceId,
              query: searchQuery,
              repositoryIds: repoIds,
              limit: 10,
            }),
          });
          if (searchResponse.ok) {
            freshCodexFindings = await searchResponse.json() as typeof freshCodexFindings;
          }
        } catch (err) {
          console.warn("[generateSpec] fresh Codex search failed, using cached findings:", err);
        }
      }

      const promptInput: TriagePromptInput = {
        analysis: {
          issueCategory: analysis.issueCategory,
          severity: analysis.severity,
          affectedComponent: analysis.affectedComponent,
          summary: analysis.summary,
          rcaSummary: analysis.rcaSummary,
          codexFindings: freshCodexFindings,
          sentryFindings: analysis.sentryFindings,
        },
        messages: analysis.thread.messages.map((m) => ({ direction: m.direction, body: m.body })),
        customerDisplayName: "Customer",
        threadTitle: analysis.thread.title,
      };

      const result = await generateEngSpec(promptInput, {
        apiKey: llmApiKey,
        model: config?.model ?? undefined,
      });

      if (!result) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to generate spec" });
      }

      // Save triage action
      await ctx.prisma.triageAction.create({
        data: {
          threadId: input.threadId,
          workspaceId: input.workspaceId,
          analysisId: analysis.id,
          action: "GENERATE_SPEC",
          linearIssueId: input.linearIssueId,
          specMarkdown: result.specMarkdown,
          createdById: input.userId,
        },
      });

      return result;
    }),

  /** Get A/B test results for investigation quality experiments */
  getABResults: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      userId: z.string(),
      phase: z.enum(["sentry", "rerank", "context_expansion", "combined"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      const logs = await ctx.prisma.analysisABLog.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.phase ? { phase: input.phase } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });

      // Aggregate stats per phase
      const stats = new Map<string, {
        count: number;
        avgLatencyMs: number;
        totalLatencyMs: number;
        withVariantData: number;
      }>();

      for (const log of logs) {
        const existing = stats.get(log.phase) ?? {
          count: 0,
          avgLatencyMs: 0,
          totalLatencyMs: 0,
          withVariantData: 0,
        };
        existing.count++;
        if (log.latencyMs) existing.totalLatencyMs += log.latencyMs;
        if (log.variantResult && Array.isArray(log.variantResult) && (log.variantResult as unknown[]).length > 0) {
          existing.withVariantData++;
        }
        stats.set(log.phase, existing);
      }

      const summary = Array.from(stats.entries()).map(([phase, s]) => ({
        phase,
        totalRuns: s.count,
        avgLatencyMs: s.count > 0 ? Math.round(s.totalLatencyMs / s.count) : 0,
        runsWithFindings: s.withVariantData,
        findingsRate: s.count > 0 ? Math.round((s.withVariantData / s.count) * 100) : 0,
      }));

      return { summary, logs };
    }),
});
