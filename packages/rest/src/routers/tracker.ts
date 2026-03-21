import { TRPCError } from "@trpc/server";
import {
  CreateTrackerConnectionSchema,
  UpdateTrackerConnectionSchema,
  DeleteTrackerConnectionSchema,
  ListTrackerConnectionsSchema,
  ListTrackerProjectsSchema,
} from "@shared/types";
import { createTRPCRouter, protectedProcedure } from "../init";
import { getTrackerService } from "../lib/tracker";

async function assertWorkspaceAdmin(params: {
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
  if (member.role !== "OWNER" && member.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only OWNER or ADMIN can manage integrations" });
  }
}

export const trackerRouter = createTRPCRouter({
  list: protectedProcedure
    .input(ListTrackerConnectionsSchema)
    .query(async ({ ctx, input }) => {
      return ctx.prisma.trackerConnection.findMany({
        where: { workspaceId: input.workspaceId },
        select: {
          id: true,
          type: true,
          label: true,
          projectKey: true,
          projectName: true,
          siteUrl: true,
          enabled: true,
          isDefault: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  create: protectedProcedure
    .input(CreateTrackerConnectionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;
      await assertWorkspaceAdmin({ prisma: ctx.prisma, workspaceId: input.workspaceId, userId });

      // Validate API token
      const service = getTrackerService(input.type);
      const valid = await service.validateToken(input.apiToken, input.siteUrl);
      if (!valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid API token" });
      }

      // If setting as default, unset previous default
      if (input.isDefault) {
        await ctx.prisma.trackerConnection.updateMany({
          where: { workspaceId: input.workspaceId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return ctx.prisma.trackerConnection.create({
        data: {
          workspaceId: input.workspaceId,
          type: input.type,
          label: input.label,
          apiToken: input.apiToken,
          projectKey: input.projectKey,
          projectName: input.projectName,
          siteUrl: input.siteUrl,
          configJson: input.configJson as Record<string, unknown> as never,
          isDefault: input.isDefault ?? false,
        },
      });
    }),

  update: protectedProcedure
    .input(UpdateTrackerConnectionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;
      await assertWorkspaceAdmin({ prisma: ctx.prisma, workspaceId: input.workspaceId, userId });

      const connection = await ctx.prisma.trackerConnection.findFirst({
        where: { id: input.id, workspaceId: input.workspaceId },
      });
      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }

      // If setting as default, unset previous default
      if (input.isDefault) {
        await ctx.prisma.trackerConnection.updateMany({
          where: { workspaceId: input.workspaceId, isDefault: true, id: { not: input.id } },
          data: { isDefault: false },
        });
      }

      return ctx.prisma.trackerConnection.update({
        where: { id: input.id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.projectKey !== undefined ? { projectKey: input.projectKey } : {}),
          ...(input.projectName !== undefined ? { projectName: input.projectName } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.configJson !== undefined ? { configJson: input.configJson as Record<string, unknown> as never } : {}),
        },
      });
    }),

  delete: protectedProcedure
    .input(DeleteTrackerConnectionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;
      await assertWorkspaceAdmin({ prisma: ctx.prisma, workspaceId: input.workspaceId, userId });

      const connection = await ctx.prisma.trackerConnection.findFirst({
        where: { id: input.id, workspaceId: input.workspaceId },
      });
      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }

      await ctx.prisma.trackerConnection.delete({ where: { id: input.id } });
      return { success: true };
    }),

  setDefault: protectedProcedure
    .input(DeleteTrackerConnectionSchema) // reuses same shape: { id, workspaceId }
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;
      await assertWorkspaceAdmin({ prisma: ctx.prisma, workspaceId: input.workspaceId, userId });

      const connection = await ctx.prisma.trackerConnection.findFirst({
        where: { id: input.id, workspaceId: input.workspaceId },
      });
      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }

      // Unset all, then set this one
      await ctx.prisma.trackerConnection.updateMany({
        where: { workspaceId: input.workspaceId, isDefault: true },
        data: { isDefault: false },
      });

      return ctx.prisma.trackerConnection.update({
        where: { id: input.id },
        data: { isDefault: true },
      });
    }),

  listProjects: protectedProcedure
    .input(ListTrackerProjectsSchema)
    .query(async ({ input }) => {
      const service = getTrackerService(input.type);
      const valid = await service.validateToken(input.apiToken, input.siteUrl);
      if (!valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid API token" });
      }
      return service.listProjects(input.apiToken, input.siteUrl);
    }),
});
