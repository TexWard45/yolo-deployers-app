import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../init";
import {
  ListMessagesByConversationSchema,
  SendConversationReplySchema,
} from "@shared/types";

export const messageRouter = createTRPCRouter({
  /** List messages for a conversation */
  listByConversation: publicProcedure
    .input(ListMessagesByConversationSchema)
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

      const conversation = await ctx.prisma.conversation.findFirst({
        where: { id: input.conversationId, workspaceId: input.workspaceId },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const messages = await ctx.prisma.conversationMessage.findMany({
        where: { conversationId: input.conversationId },
        orderBy: { sentAt: "asc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (messages.length > input.limit) {
        const next = messages.pop();
        nextCursor = next?.id;
      }

      return { messages, nextCursor };
    }),

  /** Send a reply to a conversation (creates outbound message, triggers delivery workflow) */
  sendReply: publicProcedure
    .input(SendConversationReplySchema)
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
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const now = new Date();

      const message = await ctx.prisma.conversationMessage.create({
        data: {
          conversationId: input.conversationId,
          direction: "OUTBOUND",
          senderKind: "AGENT",
          body: input.body,
          sentAt: now,
          deliveryStatus: "pending",
        },
      });

      // Update conversation timestamps
      await ctx.prisma.conversation.update({
        where: { id: input.conversationId },
        data: {
          lastMessageAt: now,
          lastOutboundAt: now,
          status: "PENDING",
        },
      });

      // TODO: Trigger deliver-support-reply workflow via Temporal
      // This will be wired up when the queue integration is complete

      return message;
    }),

  /** Resend a failed outbound message */
  resendFailed: publicProcedure
    .input(z.object({
      messageId: z.string(),
      workspaceId: z.string(),
      userId: z.string(),
    }))
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

      const message = await ctx.prisma.conversationMessage.findUnique({
        where: { id: input.messageId },
        include: { conversation: true },
      });

      if (!message || message.conversation.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      }

      if (message.deliveryStatus !== "failed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Message is not in failed state" });
      }

      await ctx.prisma.conversationMessage.update({
        where: { id: input.messageId },
        data: { deliveryStatus: "pending" },
      });

      // TODO: Trigger deliver-support-reply workflow via Temporal

      return { success: true };
    }),
});
