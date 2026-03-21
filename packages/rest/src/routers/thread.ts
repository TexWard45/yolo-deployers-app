import { TRPCError } from "@trpc/server";
import {
  AssignThreadSchema,
  GetThreadByIdSchema,
  ListThreadsSchema,
  UpdateThreadStatusSchema,
} from "@shared/types";
import { createTRPCRouter, protectedProcedure } from "../init";
import { maybeCreateTrackerIssueForThread } from "../lib/tracker";

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
  listByWorkspace: protectedProcedure
    .input(ListThreadsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      return ctx.prisma.supportThread.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          customer: true,
          assignedTo: { omit: { password: true } },
          lastAnalysis: {
            select: {
              severity: true,
              issueCategory: true,
              sufficient: true,
            },
          },
          _count: { select: { messages: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });
    }),

  getById: protectedProcedure
    .input(GetThreadByIdSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      const thread = await ctx.prisma.supportThread.findUnique({
        where: { id: input.threadId },
        include: {
          customer: true,
          assignedTo: { omit: { password: true } },
          messages: { orderBy: { createdAt: "asc" } },
          drafts: {
            where: { status: "GENERATED" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: thread.workspaceId,
        userId,
      });

      return thread;
    }),

  updateStatus: protectedProcedure
    .input(UpdateThreadStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

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
        userId,
      });

      const updated = await ctx.prisma.supportThread.update({
        where: { id: input.threadId },
        data: { status: input.status },
      });

      if (input.status === "IN_PROGRESS") {
        maybeCreateTrackerIssueForThread(
          ctx.prisma,
          input.threadId,
          thread.workspaceId,
        ).catch(() => {});
      }

      return updated;
    }),

  assign: protectedProcedure
    .input(AssignThreadSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

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
        userId,
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
