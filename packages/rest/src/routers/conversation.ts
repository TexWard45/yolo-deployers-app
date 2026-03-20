import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../init";
import {
  ListConversationsSchema,
  UpdateConversationStatusSchema,
  AssignConversationSchema,
  MergeCustomerIdentitySchema,
} from "@shared/types";

export const conversationRouter = createTRPCRouter({
  /** List conversations for a workspace with optional filters */
  list: publicProcedure
    .input(ListConversationsSchema)
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

      const where: Record<string, unknown> = { workspaceId: input.workspaceId };
      if (input.status) where.status = input.status;
      if (input.channelType) where.primaryChannelType = input.channelType;
      if (input.assignedToUserId) where.assignedToUserId = input.assignedToUserId;

      const conversations = await ctx.prisma.conversation.findMany({
        where,
        include: {
          customerProfile: true,
          assignedTo: { omit: { password: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (conversations.length > input.limit) {
        const next = conversations.pop();
        nextCursor = next?.id;
      }

      return { conversations, nextCursor };
    }),

  /** Get a single conversation by ID */
  getById: publicProcedure
    .input(z.object({ conversationId: z.string(), workspaceId: z.string(), userId: z.string() }))
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
        include: {
          customerProfile: true,
          assignedTo: { omit: { password: true } },
          drafts: {
            where: { status: "GENERATED" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      return conversation;
    }),

  /** Assign a conversation to a user (or unassign with null) */
  assign: publicProcedure
    .input(AssignConversationSchema)
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

      return ctx.prisma.conversation.update({
        where: { id: input.conversationId },
        data: { assignedToUserId: input.assignToUserId },
      });
    }),

  /** Update conversation status */
  updateStatus: publicProcedure
    .input(UpdateConversationStatusSchema)
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

      return ctx.prisma.conversation.update({
        where: { id: input.conversationId },
        data: { status: input.status },
      });
    }),

  /** Merge two customer profiles */
  mergeCustomerIdentity: publicProcedure
    .input(MergeCustomerIdentitySchema)
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

      // Move all identities and conversations from source to target
      await ctx.prisma.$transaction([
        ctx.prisma.customerChannelIdentity.updateMany({
          where: { customerProfileId: input.sourceCustomerProfileId },
          data: { customerProfileId: input.targetCustomerProfileId },
        }),
        ctx.prisma.conversation.updateMany({
          where: { customerProfileId: input.sourceCustomerProfileId },
          data: { customerProfileId: input.targetCustomerProfileId },
        }),
        ctx.prisma.customerProfile.delete({
          where: { id: input.sourceCustomerProfileId },
        }),
      ]);

      return ctx.prisma.customerProfile.findUnique({
        where: { id: input.targetCustomerProfileId },
        include: { identities: true },
      });
    }),
});
