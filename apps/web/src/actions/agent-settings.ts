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
  githubToken?: string;
  githubDefaultOwner?: string;
  githubDefaultRepo?: string;
  githubBaseBranch?: string;
  codexFixModel?: string;
  codexReviewModel?: string;
  codexFixMaxIterations?: number;
  codexRequiredCheckNames?: string[];
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const { workspaceId, ...rest } = data;
    await trpc.agent.updateWorkspaceConfig({
      workspaceId,
      userId: session.id,
      ...rest,
    });
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}
