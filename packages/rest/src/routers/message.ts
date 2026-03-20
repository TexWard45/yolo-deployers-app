import { TRPCError } from "@trpc/server";
import { CreateOutgoingDraftSchema, ListThreadMessagesSchema } from "@shared/types";
import { createTRPCRouter, protectedProcedure } from "../init";

async function assertThreadMember(params: {
  prisma: {
    supportThread: { findUnique: Function };
    workspaceMember: { findUnique: Function };
  };
  threadId: string;
  userId: string;
}) {
  const thread = await params.prisma.supportThread.findUnique({
    where: { id: params.threadId },
    select: { id: true, workspaceId: true },
  });

  if (!thread) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
  }

  const member = await params.prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: params.userId,
        workspaceId: thread.workspaceId,
      },
    },
  });

  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
  }

  return thread;
}

export const messageRouter = createTRPCRouter({
  listByThread: protectedProcedure
    .input(ListThreadMessagesSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertThreadMember({
        prisma: ctx.prisma,
        threadId: input.threadId,
        userId,
      });

      return ctx.prisma.threadMessage.findMany({
        where: { threadId: input.threadId },
        orderBy: { createdAt: "asc" },
      });
    }),

  createOutgoingDraft: protectedProcedure
    .input(CreateOutgoingDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      const thread = await assertThreadMember({
        prisma: ctx.prisma,
        threadId: input.threadId,
        userId,
      });

      const message = await ctx.prisma.threadMessage.create({
        data: {
          threadId: input.threadId,
          direction: "OUTBOUND",
          body: input.body,
        },
      });

      await ctx.prisma.supportThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: message.createdAt },
      });

      return message;
    }),
});
