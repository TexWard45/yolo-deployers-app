export const dynamic = "force-dynamic";

import { getSession } from "@/actions/auth";
import { redirect } from "next/navigation";
import { trpc } from "@/trpc/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CreateWorkspaceForm } from "@/components/admin/create-workspace-form";
import { AddMemberForm } from "@/components/admin/add-member-form";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || !session.isSystemAdmin) redirect("/");

  const users = await trpc.user.list();
  const allWorkspaces = await Promise.all(
    users.flatMap((u) =>
      trpc.workspace.listByUser({ userId: u.id })
    )
  );

  // Deduplicate workspaces
  const workspaceMap = new Map<string, (typeof allWorkspaces)[number][number]>();
  for (const list of allWorkspaces) {
    for (const ws of list) {
      workspaceMap.set(ws.id, ws);
    }
  }
  const workspaces = Array.from(workspaceMap.values());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Admin Panel</h2>
        <p className="text-muted-foreground">
          Manage all workspaces and user assignments.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle>Telemetry Demo</CardTitle>
            <CardDescription>
              Test session recording and event tracking in real-time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link 
              href="/test-telemetry" 
              className={cn(buttonVariants({ variant: "default" }), "w-full")}
            >
              Launch Test Page →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session Replays</CardTitle>
            <CardDescription>
              View recorded user sessions and playback recordings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link 
              href="/admin/replays" 
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              Open Replay Portal →
            </Link>
          </CardContent>
        </Card>
      </div>

      <CreateWorkspaceForm userId={session.id} />

      <Card>
        <CardHeader>
          <CardTitle>All Workspaces</CardTitle>
          <CardDescription>
            {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No workspaces created yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Posts</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((ws) => (
                  <TableRow key={ws.id}>
                    <TableCell className="font-medium">{ws.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {ws.slug}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {ws.members.map((m) => (
                          <Badge
                            key={m.id}
                            variant={
                              m.role === "OWNER" ? "default" : "secondary"
                            }
                          >
                            {m.user.username} ({m.role})
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{ws._count.posts}</TableCell>
                    <TableCell>
                      <AddMemberForm
                        workspaceId={ws.id}
                        users={users.map((u) => ({ id: u.id, username: u.username }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {users.length} user{users.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.username}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {user.isSystemAdmin ? (
                      <Badge>Admin</Badge>
                    ) : (
                      <Badge variant="secondary">User</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
