"use server";

import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import type { CreateCodexRepositoryInput } from "@shared/types";

export async function createCodexRepository(data: CreateCodexRepositoryInput) {
  try {
    const trpc = createCaller(createTRPCContext());
    const repo = await trpc.codex.repository.create(data);
    return { success: true, repository: repo } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function deleteCodexRepository(id: string) {
  try {
    const trpc = createCaller(createTRPCContext());
    await trpc.codex.repository.delete({ id });
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function syncCodexRepository(id: string) {
  try {
    const trpc = createCaller(createTRPCContext());
    const result = await trpc.codex.repository.sync({ id });
    return { success: true, ...result } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}
