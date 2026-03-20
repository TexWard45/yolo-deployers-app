export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { trpc } from "@/trpc/server";
import { getSession } from "@/actions/auth";
import { ManualIntakeForm } from "@/components/inbox/ManualIntakeForm";
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

  const threads = await trpc.thread.listByWorkspace({
    workspaceId: workspace.id,
    userId: session.id,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Inbox</h2>
        <p className="text-muted-foreground">
          Track customer threads and update handling status.
        </p>
      </div>

      <ManualIntakeForm workspaceId={workspace.id} />

      <ThreadList threads={threads} />
    </div>
  );
}
