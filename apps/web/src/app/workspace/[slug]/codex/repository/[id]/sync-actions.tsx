"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2 } from "lucide-react";
import { syncCodexRepository, deleteCodexRepository } from "@/actions/codex";

interface SyncActionsProps {
  repositoryId: string;
  syncStatus: string;
  workspaceSlug: string;
}

export function SyncActions({ repositoryId, syncStatus, workspaceSlug }: SyncActionsProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    const result = await syncCodexRepository(repositoryId);
    if (!result.success) {
      setError(result.error);
    }
    setSyncing(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("Delete this repository and all its indexed data?")) return;
    setDeleting(true);
    setError(null);
    const result = await deleteCodexRepository(repositoryId);
    if (!result.success) {
      setError(result.error);
      setDeleting(false);
      return;
    }
    window.location.href = `/workspace/${workspaceSlug}/codex`;
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-sm text-destructive">{error}</span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={syncing || syncStatus === "SYNCING"}
      >
        <RefreshCw className={`mr-1 size-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing..." : "Sync Now"}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={handleDelete}
        disabled={deleting}
      >
        <Trash2 className="mr-1 size-3.5" />
        {deleting ? "Deleting..." : "Delete"}
      </Button>
    </div>
  );
}
