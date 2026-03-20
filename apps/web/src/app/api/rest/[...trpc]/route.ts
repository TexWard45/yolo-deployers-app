import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { cookies } from "next/headers";
import { appRouter, createTRPCContext } from "@shared/rest";

async function getSessionUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("session")?.value;
    if (!raw) return null;
    const session = JSON.parse(raw) as { id?: string };
    return session.id ?? null;
  } catch {
    return null;
  }
}

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/rest",
    req,
    router: appRouter,
    createContext: async () =>
      createTRPCContext({ sessionUserId: await getSessionUserId() }),
  });

export { handler as GET, handler as POST };
