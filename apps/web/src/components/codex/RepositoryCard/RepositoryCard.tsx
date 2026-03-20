"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  GitBranch,
  RefreshCw,
  FileCode,
  Clock,
} from "lucide-react";
import { syncCodexRepository } from "@/actions/codex";
import { useState } from "react";

interface RepositoryCardProps {
  repository: {
    id: string;
    displayName: string;
    description: string | null;
    sourceType: string;
    sourceUrl: string;
    defaultBranch: string;
    syncStatus: string;
    lastSyncAt: Date | string | null;
    _count: {
      files: number;
    };
  };
  workspaceSlug: string;
}

const syncStatusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  IDLE: "secondary",
  SYNCING: "default",
  COMPLETED: "outline",
  FAILED: "destructive",
};

export function RepositoryCard({ repository, workspaceSlug }: RepositoryCardProps) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    const result = await syncCodexRepository(repository.id);
    if (!result.success) {
      setError(result.error);
    }
    setSyncing(false);
  }

  const lastSync = repository.lastSyncAt
    ? new Date(repository.lastSyncAt).toLocaleString()
    : "Never";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">
            <Link
              href={`/workspace/${workspaceSlug}/codex/repository/${repository.id}`}
              className="hover:underline"
            >
              {repository.displayName}
            </Link>
          </CardTitle>
          {repository.description && (
            <p className="text-sm text-muted-foreground">
              {repository.description}
            </p>
          )}
        </div>
        <Badge variant={syncStatusVariant[repository.syncStatus] ?? "secondary"}>
          {repository.syncStatus}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <GitBranch className="size-3.5" />
            {repository.defaultBranch}
          </span>
          <span className="flex items-center gap-1">
            <FileCode className="size-3.5" />
            {repository._count.files} files
          </span>
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {lastSync}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {repository.sourceType}
          </Badge>
          <Button
            variant="outline"
            size="xs"
            onClick={handleSync}
            disabled={syncing || repository.syncStatus === "SYNCING"}
          >
            <RefreshCw className={`mr-1 size-3 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync"}
          </Button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
