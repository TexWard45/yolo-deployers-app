import "server-only";
import { createCaller, createTRPCContext } from "@shared/rest";

export const trpc: ReturnType<typeof createCaller> = createCaller(createTRPCContext());
