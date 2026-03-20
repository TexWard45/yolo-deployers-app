"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateThreadStatusAction } from "@/actions/inbox";
import { Button } from "@/components/ui/button";
import { THREAD_STATUSES, type ThreadStatusValue } from "@/components/inbox/thread-status";

interface StatusActionsProps {
  threadId: string;
  currentStatus: ThreadStatusValue;
  onStatusChange?: () => void;
}

export function StatusActions({ threadId, currentStatus, onStatusChange }: StatusActionsProps) {
  const router = useRouter();
  const [loadingStatus, setLoadingStatus] = useState<ThreadStatusValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: ThreadStatusValue) {
    setError(null);
    setLoadingStatus(status);

    const result = await updateThreadStatusAction({ threadId, status });
    if (!result.success) {
      setError(result.error);
      setLoadingStatus(null);
      return;
    }

    setLoadingStatus(null);
    onStatusChange?.();
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {THREAD_STATUSES.map((status) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant={status === currentStatus ? "default" : "outline"}
            disabled={loadingStatus !== null}
            onClick={() => setStatus(status)}
          >
            {loadingStatus === status ? "Updating..." : status.replaceAll("_", " ")}
          </Button>
        ))}
      </div>
    </div>
  );
}
