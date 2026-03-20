import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../init";
import { CreateWorkspaceSchema, AddWorkspaceMemberSchema } from "@shared/types";

export const workspaceRouter = createTRPCRouter({
  /** List workspaces the user belongs to */
  listByUser: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.prisma.workspace.findMany({
        where: { members: { some: { userId: input.userId } } },
        include: {
          members: { include: { user: { omit: { password: true } } } },
          _count: { select: { posts: true, members: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  /** Get a single workspace by slug (must be a member) */
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string(), userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.prisma.workspace.findUnique({
        where: { slug: input.slug },
        include: {
          members: { include: { user: { omit: { password: true } } } },
          _count: { select: { posts: true, members: true } },
        },
      });

      if (!workspace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      const isMember = workspace.members.some((m) => m.userId === input.userId);
      if (!isMember) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
      }

      return workspace;
    }),

  /** Create a workspace (creator becomes OWNER) */
  create: publicProcedure
    .input(CreateWorkspaceSchema.extend({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.workspace.findUnique({
        where: { slug: input.slug },
      });

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Slug already taken" });
      }

      return ctx.prisma.workspace.create({
        data: {
          name: input.name,
          slug: input.slug,
          members: {
            create: { userId: input.userId, role: "OWNER" },
          },
        },
        include: { members: true },
      });
    }),

  /** Add a member to a workspace */
  addMember: publicProcedure
    .input(AddWorkspaceMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "User is already a member" });
      }

      return ctx.prisma.workspaceMember.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          role: input.role,
        },
        include: { user: { omit: { password: true } } },
      });
    }),

  /** Remove a member from a workspace */
  removeMember: publicProcedure
    .input(z.object({ workspaceId: z.string(), userId: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.prisma.workspaceMember.delete({
        where: {
          userId_workspaceId: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
      });
    }),
});
