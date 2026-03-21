export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { getSession } from "@/actions/auth";
import { ThreadList } from "@/components/inbox/ThreadList";
import { NotAuthorized } from "@/components/NotAuthorized";

interface InboxThreadPageProps {
  params: Promise<{ slug: string; threadId: string }>;
}

export default async function WorkspaceInboxThreadPage({ params }: InboxThreadPageProps) {
  const { slug, threadId } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const workspace = session.workspaces.find((w) => w.slug === slug);
  if (!workspace) redirect("/");

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const threads = await trpc.thread.listByWorkspace({
      workspaceId: workspace.id,
    });

    return <ThreadList threads={threads} currentUserId={session.id} initialThreadId={threadId} />;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") {
      return <NotAuthorized />;
    }
    throw error;
  }
}
