import { createTRPCRouter, createCallerFactory } from "./init";
import { authRouter } from "./routers/auth";
import { userRouter } from "./routers/user";
import { postRouter } from "./routers/post";
import { workspaceRouter } from "./routers/workspace";
import { channelConnectionRouter } from "./routers/channel-connection";
import { conversationRouter } from "./routers/conversation";
import { agentRouter } from "./routers/agent";
import { threadRouter } from "./routers/thread";
import { messageRouter } from "./routers/message";
import { intakeRouter } from "./routers/intake";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  post: postRouter,
  workspace: workspaceRouter,
  channelConnection: channelConnectionRouter,
  conversation: conversationRouter,
  agent: agentRouter,
  thread: threadRouter,
  message: messageRouter,
  intake: intakeRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
