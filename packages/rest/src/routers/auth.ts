import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../init";
import { LoginSchema, SignupSchema } from "@shared/types";
import { hashPassword, verifyPassword } from "../lib/password";

export const authRouter = createTRPCRouter({
  login: publicProcedure.input(LoginSchema).mutation(async ({ ctx, input }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { username: input.username },
    });

    if (!user || !(await verifyPassword(input.password, user.password))) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid username or password",
      });
    }

    const memberships = await ctx.prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: { workspace: true },
    });

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      isSystemAdmin: user.isSystemAdmin,
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
      })),
    };
  }),

  signup: publicProcedure
    .input(SignupSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.user.findUnique({
        where: { username: input.username },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Username already taken",
        });
      }

      const hashed = await hashPassword(input.password);

      const user = await ctx.prisma.user.create({
        data: {
          username: input.username,
          email: `${input.username}@placeholder.local`,
          password: hashed,
        },
      });

      return {
        id: user.id,
        username: user.username,
        name: user.name,
      };
    }),
});
