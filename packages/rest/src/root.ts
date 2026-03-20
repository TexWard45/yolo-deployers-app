import { createTRPCRouter, createCallerFactory } from "./init";
import { authRouter } from "./routers/auth";
import { userRouter } from "./routers/user";
import { postRouter } from "./routers/post";
import { workspaceRouter } from "./routers/workspace";
import { telemetryRouter } from "./routers/telemetry";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  post: postRouter,
  workspace: workspaceRouter,
  telemetry: telemetryRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
