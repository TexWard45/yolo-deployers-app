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
} from "@shared/types";
import type { Prisma } from "@shared/types/prisma";
import { dispatchAnalyzeThreadWorkflow } from "../temporal";

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
        return { ...config, sentryAuthToken: config.sentryAuthToken ? "***" : null };
      }
      return {
        id: null,
        workspaceId: input.workspaceId,
        enabled: false,
        systemPrompt: null,
        tone: null,
        replyPolicy: null,
        autoDraftOnInbound: true,
        handoffRulesJson: null,
        model: null,
        analysisEnabled: true,
        maxClarifications: 2,
        codexRepositoryIds: [] as string[],
        sentryDsn: null,
        sentryOrgSlug: null,
        sentryProjectSlug: null,
        sentryAuthToken: null,
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
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { metadata: true },
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

      // 1. Send to external channel (Discord)
      let externalMessageId: string | null = null;

      if (draft.thread.source === "DISCORD") {
        const lastInbound = draft.thread.messages[0];
        const rawPayload = (lastInbound?.metadata as Record<string, unknown> | null)?.rawPayload as Record<string, unknown> | null;
        const channelId = (rawPayload?.channelId as string) ?? null;
        const targetChannelId = draft.thread.externalThreadId.startsWith("synthetic-")
          ? channelId
          : draft.thread.externalThreadId;

        if (targetChannelId) {
          const botToken = process.env.DISCORD_BOT_TOKEN;
          if (botToken) {
            try {
              const response = await fetch(
                `https://discord.com/api/v10/channels/${targetChannelId}/messages`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bot ${botToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ content: draft.body }),
                },
              );

              if (response.ok) {
                const data = (await response.json()) as { id: string };
                externalMessageId = data.id;
                console.log(`[approveDraft] sent message ${data.id} to channel ${targetChannelId}`);
              } else {
                const error = await response.text().catch(() => "");
                console.error(`[approveDraft] Discord API error (${response.status}): ${error}`);
              }
            } catch (error) {
              console.error("[approveDraft] Discord send failed:", error);
            }
          }
        }
      }

      // 2. Record outbound message
      await ctx.prisma.threadMessage.create({
        data: {
          threadId: draft.threadId,
          direction: "OUTBOUND",
          body: draft.body,
          externalMessageId,
          metadata: { source: "ai-draft-approved", draftId: input.draftId },
        },
      });

      // 3. Update thread status + timestamps
      const now = new Date();
      await ctx.prisma.supportThread.update({
        where: { id: draft.threadId },
        data: {
          lastMessageAt: now,
          lastOutboundAt: now,
          status: "WAITING_CUSTOMER",
        },
      });

      // 4. Mark draft as SENT
      return ctx.prisma.replyDraft.update({
        where: { id: input.draftId },
        data: { status: "SENT" },
      });
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

      // Update thread with latest analysis + increment clarification count if needed
      const updateData: Record<string, unknown> = {
        lastAnalysisId: analysis.id,
      };
      if (input.draft.draftType === "CLARIFICATION") {
        updateData.clarificationCount = { increment: 1 };
      }

      await ctx.prisma.supportThread.update({
        where: { id: input.threadId },
        data: updateData,
      });

      return { analysisId: analysis.id, draftId: draft.id };
    }),
});
