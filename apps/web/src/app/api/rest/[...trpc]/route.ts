import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@shared/rest";

function extractSessionUserId(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("session="));
  if (!sessionCookie) return null;
  try {
    const raw = decodeURIComponent(sessionCookie.slice("session=".length));
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
    createContext: ({ req }) => createTRPCContext({ sessionUserId: extractSessionUserId(req) }),
  });

export { handler as GET, handler as POST };
