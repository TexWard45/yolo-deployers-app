export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createCaller, createTRPCContext } from "@shared/rest";
import { getSession } from "@/actions/auth";
import { ThreadList } from "@/components/inbox/ThreadList";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const workspace = session.workspaces[0];

  if (!workspace) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No workspace found in your session. Join or create a workspace first.
      </div>
    );
  }

  const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
  const threads = await trpc.thread.listByWorkspace({
    workspaceId: workspace.id,
  });

  return <ThreadList threads={threads} currentUserId={session.id} />;
}
