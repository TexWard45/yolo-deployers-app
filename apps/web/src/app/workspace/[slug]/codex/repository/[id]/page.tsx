export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { trpc } from "@/trpc/server";
import { getSession } from "@/actions/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  GitBranch,
  FileCode,
  Clock,
} from "lucide-react";
import { SyncActions } from "./sync-actions";

interface RepositoryDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

const syncStatusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  IDLE: "secondary",
  SYNCING: "default",
  COMPLETED: "outline",
  FAILED: "destructive",
};

export default async function RepositoryDetailPage({ params }: RepositoryDetailPageProps) {
  const { slug, id } = await params;
  const session = await getSession();

  if (!session) redirect("/login");

  const workspace = session.workspaces.find((w) => w.slug === slug);
  if (!workspace) redirect("/");

  let repository;
  try {
    repository = await trpc.codex.repository.get({ id });
  } catch {
    notFound();
  }

  const syncLogs = await trpc.codex.sync.logs({
    repositoryId: id,
    limit: 10,
  });

  const lastSync = repository.lastSyncAt
    ? new Date(repository.lastSyncAt).toLocaleString()
    : "Never";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href={`/workspace/${slug}/codex`} />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight">
            {repository.displayName}
          </h2>
          {repository.description && (
            <p className="text-sm text-muted-foreground">
              {repository.description}
            </p>
          )}
        </div>
        <SyncActions repositoryId={repository.id} syncStatus={repository.syncStatus} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Source</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{repository.sourceType}</Badge>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {repository.sourceUrl}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Branch</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-1">
            <GitBranch className="size-4 text-muted-foreground" />
            <span className="text-sm">{repository.defaultBranch}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Files</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-1">
            <FileCode className="size-4 text-muted-foreground" />
            <span className="text-2xl font-bold">{repository._count.files}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Last Sync</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-1">
            <Clock className="size-4 text-muted-foreground" />
            <span className="text-sm">{lastSync}</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Repository sync settings</CardDescription>
          </div>
          <Badge variant={syncStatusVariant[repository.syncStatus] ?? "secondary"}>
            {repository.syncStatus}
          </Badge>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="font-medium text-muted-foreground">Sync Mode</dt>
              <dd>{repository.syncMode}</dd>
            </div>
            {repository.cronExpression && (
              <div>
                <dt className="font-medium text-muted-foreground">Cron Expression</dt>
                <dd className="font-mono">{repository.cronExpression}</dd>
              </div>
            )}
            <div>
              <dt className="font-medium text-muted-foreground">Extension Allowlist</dt>
              <dd>
                {repository.extensionAllowlist.length > 0
                  ? repository.extensionAllowlist.join(", ")
                  : "All"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Path Denylist</dt>
              <dd>
                {repository.pathDenylist.length > 0
                  ? repository.pathDenylist.join(", ")
                  : "None"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Max File Size</dt>
              <dd>{(repository.maxFileSizeBytes / 1024).toFixed(0)} KB</dd>
            </div>
            {repository.lastSyncCommit && (
              <div>
                <dt className="font-medium text-muted-foreground">Last Sync Commit</dt>
                <dd className="font-mono">{repository.lastSyncCommit.slice(0, 8)}</dd>
              </div>
            )}
          </dl>
          {repository.lastSyncError && (
            <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {repository.lastSyncError}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync History</CardTitle>
          <CardDescription>Recent sync operations</CardDescription>
        </CardHeader>
        <CardContent>
          {syncLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sync history yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Embeddings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge variant={syncStatusVariant[log.status] ?? "secondary"}>
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {new Date(log.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.completedAt
                        ? new Date(log.completedAt).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell>{log.filesChanged}</TableCell>
                    <TableCell>
                      +{log.chunksCreated} / ~{log.chunksUpdated} / -{log.chunksDeleted}
                    </TableCell>
                    <TableCell>{log.embeddingsGen}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
