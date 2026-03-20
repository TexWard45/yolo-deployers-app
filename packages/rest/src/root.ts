import { createTRPCRouter, createCallerFactory } from "./init";
import { authRouter } from "./routers/auth";
import { userRouter } from "./routers/user";
import { postRouter } from "./routers/post";
import { workspaceRouter } from "./routers/workspace";
import { codexRouter } from "./routers/codex";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  post: postRouter,
  workspace: workspaceRouter,
  codex: codexRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
