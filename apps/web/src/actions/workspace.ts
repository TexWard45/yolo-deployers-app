"use server";

import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

export async function createWorkspace(data: {
  name: string;
  slug: string;
  userId: string;
}) {
  try {
    const trpc = createCaller(createTRPCContext());
    const workspace = await trpc.workspace.create(data);
    return { success: true, workspace } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function addMemberToWorkspace(data: {
  workspaceId: string;
  userId: string;
  role: string;
}) {
  try {
    const trpc = createCaller(createTRPCContext());
    const member = await trpc.workspace.addMember({
      workspaceId: data.workspaceId,
      userId: data.userId,
      role: data.role as "OWNER" | "ADMIN" | "MEMBER",
    });
    return { success: true, member } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}
