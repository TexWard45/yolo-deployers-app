export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { getSession } from "@/actions/auth";
import { ThreadDetail } from "@/components/inbox/ThreadDetail";

interface ThreadDetailPageProps {
  params: Promise<{ slug: string; threadId: string }>;
}

export default async function WorkspaceThreadDetailPage({ params }: ThreadDetailPageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { threadId } = await params;
  const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
  const thread = await trpc.thread
    .getById({ threadId })
    .catch((error: unknown) => {
      if (error instanceof TRPCError && error.code === "FORBIDDEN") {
        redirect("/");
      }
      return null;
    });

  if (!thread) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        Thread not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Thread Detail</h2>
        <p className="text-muted-foreground">Review timeline and update status.</p>
      </div>
      <ThreadDetail thread={thread} />
    </div>
  );
}
