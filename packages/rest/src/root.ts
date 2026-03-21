import { createTRPCRouter, createCallerFactory } from "./init";
import { authRouter } from "./routers/auth";
import { userRouter } from "./routers/user";
import { postRouter } from "./routers/post";
import { workspaceRouter } from "./routers/workspace";
import { codexRouter } from "./routers/codex";
import { channelConnectionRouter } from "./routers/channel-connection";
import { agentRouter } from "./routers/agent";
import { threadRouter } from "./routers/thread";
import { messageRouter } from "./routers/message";
import { intakeRouter } from "./routers/intake";
import { telemetryRouter } from "./routers/telemetry";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  post: postRouter,
  workspace: workspaceRouter,
  codex: codexRouter,
  channelConnection: channelConnectionRouter,
  agent: agentRouter,
  thread: threadRouter,
  message: messageRouter,
  intake: intakeRouter,
  telemetry: telemetryRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
