export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { getSession } from "@/actions/auth";
import { ThreadList } from "@/components/inbox/ThreadList";
import { NotAuthorized } from "@/components/NotAuthorized";

interface InboxPageProps {
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceInboxPage({ params }: InboxPageProps) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const workspace = session.workspaces.find((w) => w.slug === slug);
  if (!workspace) redirect("/");

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const threads = await trpc.thread.listByWorkspace({
      workspaceId: workspace.id,
    });

    return <ThreadList threads={threads} currentUserId={session.id} />;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") {
      return <NotAuthorized />;
    }
    throw error;
  }
}
