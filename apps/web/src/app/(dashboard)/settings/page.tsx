export const dynamic = "force-dynamic";

import { getSession } from "@/actions/auth";
import { redirect } from "next/navigation";
import { createCaller, createTRPCContext } from "@shared/rest";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrackerConnectionCard } from "@/components/settings/TrackerConnectionCard";
import { AddTrackerForm } from "@/components/settings/AddTrackerForm";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const workspaces = session.workspaces ?? [];
  const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));

  const trackersByWorkspace = await Promise.all(
    workspaces.map(async (ws) => {
      try {
        const connections = await trpc.tracker.list({ workspaceId: ws.id });
        return { workspaceId: ws.id, connections };
      } catch {
        return { workspaceId: ws.id, connections: [] };
      }
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage your account and workspace memberships.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Username
              </p>
              <p className="text-sm">{session.username}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Name</p>
              <p className="text-sm">{session.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Role</p>
              <p className="text-sm">
                {session.isSystemAdmin ? (
                  <Badge>System Admin</Badge>
                ) : (
                  <Badge variant="secondary">User</Badge>
                )}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                User ID
              </p>
              <p className="text-sm font-mono text-xs">{session.id}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Workspaces</CardTitle>
          <CardDescription>
            Workspaces you are a member of
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You are not a member of any workspace yet.
            </p>
          ) : (
            <div className="space-y-3">
              {workspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{ws.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      /{ws.slug}
                    </p>
                  </div>
                  <Badge
                    variant={ws.role === "OWNER" ? "default" : "secondary"}
                  >
                    {ws.role}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {workspaces.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>
              Connect project trackers to auto-create issues from support threads
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {workspaces.map((ws) => {
              const tracker = trackersByWorkspace.find((t) => t.workspaceId === ws.id);
              const connections = tracker?.connections ?? [];
              return (
                <div key={ws.id} className="space-y-3">
                  {workspaces.length > 1 && (
                    <p className="text-xs font-medium text-muted-foreground">{ws.name}</p>
                  )}
                  {connections.map((conn) => (
                    <TrackerConnectionCard
                      key={conn.id}
                      connection={conn}
                      workspaceId={ws.id}
                    />
                  ))}
                  <AddTrackerForm workspaceId={ws.id} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
