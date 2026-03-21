import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../init";
import {
  CreateChannelConnectionSchema,
  UpdateChannelConnectionStatusSchema,
  DiscordChannelConfigSchema,
} from "@shared/types";
import { dispatchSyncDiscordChannelsWorkflow } from "../temporal";

export const channelConnectionRouter = createTRPCRouter({
  /** List channel connections for a workspace */
  listByWorkspace: publicProcedure
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

      return ctx.prisma.channelConnection.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: "desc" },
      });
    }),

  /** Create a channel connection (OWNER/ADMIN only) */
  createDiscordConnection: publicProcedure
    .input(CreateChannelConnectionSchema)
    .mutation(async ({ ctx, input }) => {
      // Validate Discord-specific configJson when type is DISCORD
      if (input.type === "DISCORD") {
        const parsed = DiscordChannelConfigSchema.safeParse(input.configJson);
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid Discord config: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          });
        }
      }

      return ctx.prisma.channelConnection.create({
        data: {
          workspaceId: input.workspaceId,
          type: input.type,
          name: input.name,
          externalAccountId: input.externalAccountId,
          configJson: input.configJson as Record<string, unknown> as never,
        },
      });
    }),

  /** Update connection status (OWNER/ADMIN only) */
  updateConnectionStatus: publicProcedure
    .input(UpdateChannelConnectionStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const connection = await ctx.prisma.channelConnection.findFirst({
        where: { id: input.id, workspaceId: input.workspaceId },
      });

      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Channel connection not found" });
      }

      return ctx.prisma.channelConnection.update({
        where: { id: input.id },
        data: { status: input.status },
      });
    }),

  /** Disconnect a channel (OWNER/ADMIN only) */
  disconnect: publicProcedure
    .input(z.object({ id: z.string(), workspaceId: z.string(), userId: z.string() }))
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
        throw new TRPCError({ code: "FORBIDDEN", message: "Only OWNER or ADMIN can disconnect channels" });
      }

      const connection = await ctx.prisma.channelConnection.findFirst({
        where: { id: input.id, workspaceId: input.workspaceId },
      });

      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Channel connection not found" });
      }

      return ctx.prisma.channelConnection.delete({
        where: { id: input.id },
      });
    }),

  /** Sync Discord channels — discover channels matching a name filter and backfill messages */
  syncChannels: publicProcedure
    .input(
      z.object({
        channelConnectionId: z.string(),
        workspaceId: z.string(),
        userId: z.string(),
        nameFilter: z.string().default(""),
      }),
    )
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

      const connection = await ctx.prisma.channelConnection.findFirst({
        where: {
          id: input.channelConnectionId,
          workspaceId: input.workspaceId,
          type: "DISCORD",
        },
      });

      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Discord connection not found" });
      }

      if (!connection.externalAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Connection has no guild ID" });
      }

      await dispatchSyncDiscordChannelsWorkflow({
        channelConnectionId: input.channelConnectionId,
        workspaceId: input.workspaceId,
        nameFilter: input.nameFilter,
      });

      return { dispatched: true };
    }),

  /** Update channel IDs in a connection's config (called by queue activities) */
  updateChannels: publicProcedure
    .input(
      z.object({
        channelConnectionId: z.string(),
        channelIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const connection = await ctx.prisma.channelConnection.findUniqueOrThrow({
        where: { id: input.channelConnectionId },
      });

      const parsed = DiscordChannelConfigSchema.safeParse(connection.configJson);
      const existingConfig = parsed.success ? parsed.data : { channelIds: [], listenToThreads: true };

      return ctx.prisma.channelConnection.update({
        where: { id: input.channelConnectionId },
        data: {
          configJson: {
            ...existingConfig,
            channelIds: input.channelIds,
          } as Record<string, unknown> as never,
        },
      });
    }),
});
