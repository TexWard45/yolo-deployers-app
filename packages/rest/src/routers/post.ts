import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../init";
import { CreatePostSchema } from "@shared/types";

export const postRouter = createTRPCRouter({
  /** List posts scoped to a workspace */
  list: publicProcedure
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

      return ctx.prisma.post.findMany({
        where: { workspaceId: input.workspaceId },
        include: { author: { omit: { password: true } } },
        orderBy: { createdAt: "desc" },
      });
    }),

  /** Create a post within a workspace */
  create: publicProcedure
    .input(CreatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.authorId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      return ctx.prisma.post.create({ data: input });
    }),
});
