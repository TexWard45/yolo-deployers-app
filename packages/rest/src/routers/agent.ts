import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../init";
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
  TestSentryConnectionSchema,
} from "@shared/types";
import type { Prisma } from "@shared/types/prisma";
import { dispatchAnalyzeThreadWorkflow } from "../temporal";
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

export const agentRouter = createTRPCRouter({
  /** Get workspace AI agent config */
  getWorkspaceConfig: publicProcedure
    .input(z.object({ workspaceId: z.string(), userId: z.string() }))
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

      const config = await ctx.prisma.workspaceAgentConfig.findUnique({
        where: { workspaceId: input.workspaceId },
      });

      // Return default config if none exists (redact sentryAuthToken)
      if (config) {
        return {
          ...config,
          sentryAuthToken: config.sentryAuthToken ? "***" : null,
          linearApiKey: config.linearApiKey ? "***" : null,
        };
      }
      return {
        id: null,
        workspaceId: input.workspaceId,
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
        sentryProjectSlugs: [] as string[],
        investigationABEnabled: false,
        linearApiKey: null,
        linearTeamId: null,
        linearDefaultLabels: [] as string[],
        threadRecencyWindowMinutes: 0,
        createdAt: null,
        updatedAt: null,
      };
    }),

  /** Update workspace AI agent config (OWNER/ADMIN only) */
  updateWorkspaceConfig: publicProcedure
    .input(UpdateWorkspaceAgentConfigSchema)
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
        throw new TRPCError({ code: "FORBIDDEN", message: "Only OWNER or ADMIN can configure AI agent" });
      }

      const { workspaceId, userId, handoffRulesJson, ...rest } = input;
      const data = {
        ...rest,
        ...(handoffRulesJson !== undefined
          ? { handoffRulesJson: handoffRulesJson as Record<string, unknown> as never }
          : {}),
      };

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

      // Update thread with latest analysis + summary + increment clarification count if needed
      const updateData: Record<string, unknown> = {
        lastAnalysisId: analysis.id,
        summary: input.analysis.summary,
        summaryUpdatedAt: new Date(),
      };
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
          specMarkdown: h.specMarkdown,
          createdBy: h.createdBy.username,
          createdAt: h.createdAt.toISOString(),
        })),
      };
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
