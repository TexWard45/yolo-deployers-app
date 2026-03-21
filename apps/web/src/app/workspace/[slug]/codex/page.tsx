export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { trpc } from "@/trpc/server";
import { getSession } from "@/actions/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, FileCode, Boxes, Cpu, Plus, Search } from "lucide-react";
import { RepositoryCard } from "@/components/codex/RepositoryCard";

interface CodexDashboardPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CodexDashboardPage({ params }: CodexDashboardPageProps) {
  const { slug } = await params;
  const session = await getSession();

  if (!session) redirect("/login");

  const workspace = session.workspaces.find((w) => w.slug === slug);
  if (!workspace) redirect("/");

  const [stats, repositories] = await Promise.all([
    trpc.codex.stats({ workspaceId: workspace.id }),
    trpc.codex.repository.list({ workspaceId: workspace.id }),
  ]);

  const statCards = [
    {
      title: "Repositories",
      value: stats.repositories,
      icon: Database,
      color: "oklch(0.89 0.18 192)",
    },
    {
      title: "Files Indexed",
      value: stats.files,
      icon: FileCode,
      color: "oklch(0.87 0.29 142)",
    },
    {
      title: "Code Chunks",
      value: stats.chunks,
      icon: Boxes,
      color: "oklch(0.55 0.25 264)",
    },
    {
      title: "Embedded",
      value: stats.embeddedChunks,
      icon: Cpu,
      color: "oklch(0.82 0.16 85)",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="gradient-text text-3xl font-bold tracking-tight">Codex</h2>
          <p className="text-muted-foreground">
            Code search and repository indexing
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href={`/workspace/${slug}/codex/search`} />}>
            <Search className="mr-2 size-4" />
            Search
          </Button>
          <Button nativeButton={false} render={<Link href={`/workspace/${slug}/codex/repository/new`} />}>
            <Plus className="mr-2 size-4" />
            Add Repository
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h3 className="mb-4 text-lg font-semibold">Repositories</h3>
        {repositories.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Database className="mb-4 size-12 text-muted-foreground" />
              <p className="mb-2 text-sm text-muted-foreground">
                No repositories yet
              </p>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/workspace/${slug}/codex/repository/new`} />}
              >
                <Plus className="mr-2 size-4" />
                Add your first repository
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {repositories.map((repo) => (
              <RepositoryCard
                key={repo.id}
                repository={repo}
                workspaceSlug={slug}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
