"use server";

import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import { getSession } from "@/actions/auth";

export async function updateAgentConfigAction(data: {
  workspaceId: string;
  enabled?: boolean;
  autoReply?: boolean;
  analysisEnabled?: boolean;
  autoDraftOnInbound?: boolean;
  maxClarifications?: number;
  tone?: string;
  systemPrompt?: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    await trpc.agent.updateWorkspaceConfig({
      userId: session.id,
      ...data,
    });
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}
