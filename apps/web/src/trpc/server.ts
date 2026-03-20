import "server-only";
import { createCaller, createTRPCContext } from "@shared/rest";

export const trpc = createCaller(createTRPCContext());
