import { createTRPCRouter, publicProcedure } from "../init";
import { CreateUserSchema } from "@shared/types";

export const userRouter = createTRPCRouter({
  list: publicProcedure.query(({ ctx }) => {
    return ctx.prisma.user.findMany();
  }),

  create: publicProcedure.input(CreateUserSchema).mutation(({ ctx, input }) => {
    return ctx.prisma.user.create({ data: input });
  }),
});
