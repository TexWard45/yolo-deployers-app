"use server";

import { cookies } from "next/headers";
import { createCaller, createTRPCContext } from "@shared/rest";
import { webEnv } from "@shared/env/web";
import { TRPCError } from "@trpc/server";

export async function login(data: { username: string; password: string }) {
  try {
    const trpc = createCaller(createTRPCContext());
    const user = await trpc.auth.login(data);

    const cookieStore = await cookies();
    cookieStore.set("session", JSON.stringify(user), {
      httpOnly: true,
      secure: webEnv.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return { success: true, user } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function signup(data: { username: string; password: string }) {
  try {
    const trpc = createCaller(createTRPCContext());
    const user = await trpc.auth.signup(data);
    return { success: true, user } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete("session");
}

export async function getSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get("session");
  if (!session?.value) return null;
  try {
    return JSON.parse(session.value) as {
      id: string;
      username: string;
      name: string | null;
      isSystemAdmin: boolean;
      workspaces: Array<{
        id: string;
        name: string;
        slug: string;
        role: string;
      }>;
    };
  } catch {
    return null;
  }
}
