export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { trpc } from "@/trpc/server";
import { getSession } from "@/actions/auth";
import { ThreadDetail } from "@/components/inbox/ThreadDetail";

interface ThreadDetailPageProps {
  params: Promise<{ threadId: string }>;
}

export default async function ThreadDetailPage({ params }: ThreadDetailPageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { threadId } = await params;
  const thread = await trpc.thread
    .getById({
      threadId,
      userId: session.id,
    })
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
        <p className="text-muted-foreground">
          Review timeline and update status.
        </p>
      </div>
      <ThreadDetail thread={thread} />
    </div>
  );
}
