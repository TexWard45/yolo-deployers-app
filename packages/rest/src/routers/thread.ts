import { TRPCError } from "@trpc/server";
import {
  AssignThreadSchema,
  GetThreadByIdSchema,
  ListThreadsSchema,
  UpdateThreadStatusSchema,
} from "@shared/types";
import { createTRPCRouter, publicProcedure } from "../init";

async function assertWorkspaceMember(params: {
  prisma: { workspaceMember: { findUnique: Function } };
  workspaceId: string;
  userId: string;
}) {
  const member = await params.prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: params.userId,
        workspaceId: params.workspaceId,
      },
    },
  });

  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
  }
}

export const threadRouter = createTRPCRouter({
  listByWorkspace: publicProcedure
    .input(ListThreadsSchema)
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId: input.userId,
      });

      return ctx.prisma.supportThread.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          customer: true,
          assignedTo: { omit: { password: true } },
          _count: { select: { messages: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });
    }),

  getById: publicProcedure
    .input(GetThreadByIdSchema)
    .query(async ({ ctx, input }) => {
      const thread = await ctx.prisma.supportThread.findUnique({
        where: { id: input.threadId },
        include: {
          customer: true,
          assignedTo: { omit: { password: true } },
          messages: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: thread.workspaceId,
        userId: input.userId,
      });

      return thread;
    }),

  updateStatus: publicProcedure
    .input(UpdateThreadStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const thread = await ctx.prisma.supportThread.findUnique({
        where: { id: input.threadId },
        select: { id: true, workspaceId: true },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: thread.workspaceId,
        userId: input.userId,
      });

      return ctx.prisma.supportThread.update({
        where: { id: input.threadId },
        data: { status: input.status },
      });
    }),

  assign: publicProcedure
    .input(AssignThreadSchema)
    .mutation(async ({ ctx, input }) => {
      const thread = await ctx.prisma.supportThread.findUnique({
        where: { id: input.threadId },
        select: { id: true, workspaceId: true },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: thread.workspaceId,
        userId: input.userId,
      });

      if (input.assignedToId) {
        await assertWorkspaceMember({
          prisma: ctx.prisma,
          workspaceId: thread.workspaceId,
          userId: input.assignedToId,
        });
      }

      return ctx.prisma.supportThread.update({
        where: { id: input.threadId },
        data: { assignedToId: input.assignedToId },
      });
    }),
});
