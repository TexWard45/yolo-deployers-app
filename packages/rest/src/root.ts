import { createTRPCRouter, createCallerFactory } from "./init";
import { authRouter } from "./routers/auth";
import { userRouter } from "./routers/user";
import { postRouter } from "./routers/post";
import { workspaceRouter } from "./routers/workspace";
import { channelConnectionRouter } from "./routers/channel-connection";
import { conversationRouter } from "./routers/conversation";
import { messageRouter } from "./routers/message";
import { agentRouter } from "./routers/agent";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  post: postRouter,
  workspace: workspaceRouter,
  channelConnection: channelConnectionRouter,
  conversation: conversationRouter,
  message: messageRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
