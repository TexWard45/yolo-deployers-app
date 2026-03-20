export const dynamic = "force-dynamic";

import { getSession } from "@/actions/auth";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const workspaces = session.workspaces ?? [];

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
    </div>
  );
}
