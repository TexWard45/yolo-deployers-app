"use server";

import { revalidatePath } from "next/cache";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import { getSession } from "@/actions/auth";

export async function createTrackerConnection(data: {
  workspaceId: string;
  type: "LINEAR" | "JIRA";
  label: string;
  apiToken: string;
  projectKey: string;
  projectName: string;
  siteUrl?: string;
  isDefault?: boolean;
}) {
  const session = await getSession();
  if (!session) return { success: false, error: "Not authenticated" } as const;

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    await trpc.tracker.create(data);
    revalidatePath("/settings");
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function deleteTrackerConnection(id: string, workspaceId: string) {
  const session = await getSession();
  if (!session) return { success: false, error: "Not authenticated" } as const;

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    await trpc.tracker.delete({ id, workspaceId });
    revalidatePath("/settings");
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function setDefaultTrackerConnection(id: string, workspaceId: string) {
  const session = await getSession();
  if (!session) return { success: false, error: "Not authenticated" } as const;

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    await trpc.tracker.setDefault({ id, workspaceId });
    revalidatePath("/settings");
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}
