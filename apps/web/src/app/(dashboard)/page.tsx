export const dynamic = "force-dynamic";

import { trpc } from "@/trpc/server";
import { getSession } from "@/actions/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users, FileText, Activity, TrendingUp } from "lucide-react";

export default async function DashboardPage() {
  const session = await getSession();
  let users: Awaited<ReturnType<typeof trpc.user.list>> = [];
  let dataLoadWarning: string | null = null;

  try {
    users = await trpc.user.list();
  } catch (error) {
    console.error("[dashboard] failed to load users", error);
    dataLoadWarning = "Some dashboard data is temporarily unavailable. Check your database connection.";
  }

  // Gather posts across all workspaces the user belongs to
  const workspaceIds = session?.workspaces?.map((w) => w.id) ?? [];
  const postResults = await Promise.all(
    workspaceIds.map((wId) =>
      trpc.post.list({ workspaceId: wId, userId: session!.id }).catch((error) => {
        console.error(`[dashboard] failed to load posts for workspace ${wId}`, error);
        if (!dataLoadWarning) {
          dataLoadWarning = "Some dashboard data is temporarily unavailable. Check your database connection.";
        }
        return [];
      })
    )
  );
  const allPosts = postResults.flat();

  const stats = [
    {
      title: "Total Users",
      value: users.length,
      description: "Registered users",
      icon: Users,
    },
    {
      title: "Total Posts",
      value: allPosts.length,
      description: "Across your workspaces",
      icon: FileText,
    },
    {
      title: "Workspaces",
      value: workspaceIds.length,
      description: "You belong to",
      icon: Activity,
    },
    {
      title: "Growth",
      value: "—",
      description: "This month",
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Overview of your application.
        </p>
      </div>

      {dataLoadWarning ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {dataLoadWarning}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Users</CardTitle>
            <CardDescription>Latest registered users</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users yet.</p>
            ) : (
              <div className="space-y-3">
                {users.slice(0, 5).map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {user.name ?? user.username}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    {user.isSystemAdmin && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                        Admin
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Posts</CardTitle>
            <CardDescription>Latest across your workspaces</CardDescription>
          </CardHeader>
          <CardContent>
            {allPosts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No posts yet.</p>
            ) : (
              <div className="space-y-3">
                {allPosts.slice(0, 5).map((post) => (
                  <div
                    key={post.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{post.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {post.published ? "Published" : "Draft"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
