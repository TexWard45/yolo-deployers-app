import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../init";
import {
  UpdateWorkspaceAgentConfigSchema,
  GenerateReplyDraftSchema,
  ApproveDraftSchema,
  DismissDraftSchema,
} from "@shared/types";

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

      // Return default config if none exists
      return config ?? {
        id: null,
        workspaceId: input.workspaceId,
        enabled: false,
        systemPrompt: null,
        tone: null,
        replyPolicy: null,
        autoDraftOnInbound: true,
        handoffRulesJson: null,
        model: null,
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

  /** Approve a draft (marks it ready for sending) */
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
        include: { thread: true },
      });

      if (!draft || draft.thread.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      if (draft.status !== "GENERATED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Draft is not in GENERATED state" });
      }

      return ctx.prisma.replyDraft.update({
        where: { id: input.draftId },
        data: { status: "APPROVED" },
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
});
