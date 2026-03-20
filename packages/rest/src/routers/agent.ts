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

  /** Generate an AI draft reply for a conversation */
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

      const conversation = await ctx.prisma.conversation.findFirst({
        where: { id: input.conversationId, workspaceId: input.workspaceId },
        include: {
          messages: { orderBy: { sentAt: "desc" }, take: 10 },
          customerProfile: true,
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const lastMessage = conversation.messages[0];

      // Create a placeholder draft — the actual AI generation will be
      // handled by the generate-reply-draft queue workflow
      const draft = await ctx.prisma.replyDraft.create({
        data: {
          conversationId: input.conversationId,
          basedOnMessageId: lastMessage?.id,
          createdByUserId: input.userId,
          status: "GENERATED",
          body: "", // Will be populated by the workflow
          model: null,
          promptVersion: null,
        },
      });

      // TODO: Trigger generate-reply-draft workflow via Temporal
      // For now, generate a simple placeholder
      const threadContext = conversation.messages
        .reverse()
        .map((m) => `${m.senderKind}: ${m.body}`)
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
        include: { conversation: true },
      });

      if (!draft || draft.conversation.workspaceId !== input.workspaceId) {
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
        include: { conversation: true },
      });

      if (!draft || draft.conversation.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      return ctx.prisma.replyDraft.update({
        where: { id: input.draftId },
        data: { status: "DISMISSED" },
      });
    }),
});
