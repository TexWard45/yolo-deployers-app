"use server";

import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import { getSession } from "@/actions/auth";

export async function testSentryConnectionAction(data: {
  workspaceId: string;
  sentryOrgSlug: string;
  sentryProjectSlug: string;
  sentryAuthToken: string;
}) {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    return await trpc.agent.testSentryConnection({
      workspaceId: data.workspaceId,
      userId: session.id,
      sentryOrgSlug: data.sentryOrgSlug,
      sentryProjectSlug: data.sentryProjectSlug,
      sentryAuthToken: data.sentryAuthToken,
    });
  } catch (error) {
    if (error instanceof TRPCError) {
      return { ok: false, error: error.message } as const;
    }
    return { ok: false, error: "Something went wrong" } as const;
  }
}

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
  sentryOrgSlug?: string;
  sentryProjectSlug?: string;
  sentryAuthToken?: string;
  linearApiKey?: string;
  linearTeamId?: string;
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

export async function syncDiscordChannelsAction(data: {
  workspaceId: string;
  channelConnectionId: string;
  nameFilter?: string;
}) {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    await trpc.channelConnection.syncChannels({
      channelConnectionId: data.channelConnectionId,
      workspaceId: data.workspaceId,
      userId: session.id,
      nameFilter: data.nameFilter ?? "",
    });
    return { ok: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { ok: false, error: error.message } as const;
    }
    return { ok: false, error: "Something went wrong" } as const;
  }
}
