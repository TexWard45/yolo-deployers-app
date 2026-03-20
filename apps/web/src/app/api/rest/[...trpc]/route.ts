import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@shared/rest";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/rest",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  });

export { handler as GET, handler as POST };
