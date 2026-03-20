// @ts-nocheck — router references schema models not yet migrated
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@shared/types/prisma";
import {
  IngestExternalMessageSchema,
  ThreadStatusSchema,
  UpsertExternalCustomerSchema,
  UpsertExternalThreadSchema,
} from "@shared/types";
import { createTRPCRouter, protectedProcedure } from "../init";

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

export const intakeRouter = createTRPCRouter({
  upsertExternalCustomer: protectedProcedure
    .input(UpsertExternalCustomerSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      return ctx.prisma.customer.upsert({
        where: {
          workspaceId_source_externalCustomerId: {
            workspaceId: input.workspaceId,
            source: input.source,
            externalCustomerId: input.externalCustomerId,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          source: input.source,
          externalCustomerId: input.externalCustomerId,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          email: input.email,
        },
        update: {
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          email: input.email,
        },
      });
    }),

  upsertExternalThread: protectedProcedure
    .input(UpsertExternalThreadSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      return ctx.prisma.supportThread.upsert({
        where: {
          workspaceId_source_externalThreadId: {
            workspaceId: input.workspaceId,
            source: input.source,
            externalThreadId: input.externalThreadId,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          customerId: input.customerId,
          source: input.source,
          externalThreadId: input.externalThreadId,
          title: input.title,
          status: input.status,
        },
        update: {
          customerId: input.customerId,
          title: input.title,
          status: input.status,
        },
      });
    }),

  ingestExternalMessage: protectedProcedure
    .input(IngestExternalMessageSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      return ctx.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.upsert({
          where: {
            workspaceId_source_externalCustomerId: {
              workspaceId: input.workspaceId,
              source: input.source,
              externalCustomerId: input.externalCustomerId,
            },
          },
          create: {
            workspaceId: input.workspaceId,
            source: input.source,
            externalCustomerId: input.externalCustomerId,
            displayName: input.customerDisplayName,
            avatarUrl: input.customerAvatarUrl,
            email: input.customerEmail,
          },
          update: {
            displayName: input.customerDisplayName,
            avatarUrl: input.customerAvatarUrl,
            email: input.customerEmail,
          },
        });

        const thread = await tx.supportThread.upsert({
          where: {
            workspaceId_source_externalThreadId: {
              workspaceId: input.workspaceId,
              source: input.source,
              externalThreadId: input.externalThreadId,
            },
          },
          create: {
            workspaceId: input.workspaceId,
            customerId: customer.id,
            source: input.source,
            externalThreadId: input.externalThreadId,
            title: input.title,
            status: "WAITING_REVIEW",
          },
          update: {
            customerId: customer.id,
            title: input.title,
            status: "WAITING_REVIEW",
          },
        });

        const existingMessage =
          input.externalMessageId
            ? await tx.threadMessage.findUnique({
                where: {
                  threadId_externalMessageId: {
                    threadId: thread.id,
                    externalMessageId: input.externalMessageId,
                  },
                },
              })
            : null;

        const message =
          existingMessage ??
          (await tx.threadMessage.create({
            data: {
              threadId: thread.id,
              direction: "INBOUND",
              body: input.messageBody,
              externalMessageId: input.externalMessageId,
              metadata: input.metadata as Prisma.InputJsonValue | undefined,
            },
          }));

        const updatedThread = await tx.supportThread.update({
          where: { id: thread.id },
          data: { lastMessageAt: message.createdAt },
        });

        return { customer, thread: updatedThread, message };
      });
    }),

  touchThreadStatusFromIngestion: protectedProcedure
    .input(
      UpsertExternalThreadSchema.pick({
        workspaceId: true,
        source: true,
        externalThreadId: true,
      }).extend({
        status: ThreadStatusSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      const thread = await ctx.prisma.supportThread.findUnique({
        where: {
          workspaceId_source_externalThreadId: {
            workspaceId: input.workspaceId,
            source: input.source,
            externalThreadId: input.externalThreadId,
          },
        },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      return ctx.prisma.supportThread.update({
        where: { id: thread.id },
        data: { status: input.status },
      });
    }),
});
