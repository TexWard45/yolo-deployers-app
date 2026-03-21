"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThreadCard } from "@/components/inbox/ThreadCard";
import { ThreadDetailSheet } from "@/components/inbox/ThreadDetailSheet";
import { updateThreadStatusAction } from "@/actions/inbox";
import {
  THREAD_STATUSES,
  THREAD_STATUS_LABEL,
  type ThreadStatusValue,
} from "@/components/inbox/thread-status";

const REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5_000 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "5m", value: 300_000 },
] as const;

interface ThreadListItem {
  id: string;
  title: string | null;
  summary: string | null;
  status: ThreadStatusValue;
  updatedAt: Date;
  customer: {
    displayName: string;
  };
  assignedTo?: {
    name: string | null;
    email: string;
  } | null;
  _count: {
    messages: number;
  };
}

interface ThreadListProps {
  threads: ThreadListItem[];
}

const STATUS_COLOR: Record<ThreadStatusValue, string> = {
  NEW: "text-blue-600",
  WAITING_REVIEW: "text-amber-600",
  WAITING_CUSTOMER: "text-violet-600",
  ESCALATED: "text-red-600",
  IN_PROGRESS: "text-emerald-600",
  CLOSED: "text-muted-foreground",
};

export function ThreadList({ threads }: ThreadListProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [localThreads, setLocalThreads] = useState(threads);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ThreadStatusValue | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doRefresh = useCallback(() => {
    setIsRefreshing(true);
    router.refresh();
    // The spinner clears once the new props arrive via the useEffect below
  }, [router]);

  // Clear refreshing state when new data arrives
  useEffect(() => {
    setLocalThreads(threads);
    setIsRefreshing(false);
  }, [threads]);

  // Auto-refresh interval
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(doRefresh, refreshInterval);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshInterval, doRefresh]);

  const activeRefreshLabel =
    REFRESH_OPTIONS.find((o) => o.value === refreshInterval)?.label ?? "Off";

  // Derive base inbox path for URL updates (e.g. /workspace/yolo-deployers/inbox or /inbox)
  const inboxBasePath = pathname.replace(/\/[^/]+$/, "").endsWith("/inbox")
    ? pathname.replace(/\/[^/]+$/, "")
    : pathname;

  function selectThread(threadId: string | null) {
    setSelectedId(threadId);
    if (threadId) {
      window.history.replaceState(null, "", `${inboxBasePath}/${threadId}`);
    } else {
      window.history.replaceState(null, "", inboxBasePath);
    }
  }

  function handleDragStart(e: React.DragEvent, threadId: string) {
    e.dataTransfer.setData("text/plain", threadId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetStatus: ThreadStatusValue) {
    e.preventDefault();
    setDragOverColumn(null);

    const threadId = e.dataTransfer.getData("text/plain");
    const thread = localThreads.find((t) => t.id === threadId);
    if (!thread || thread.status === targetStatus) return;

    const previousStatus = thread.status;

    // Optimistic: move the card immediately
    setLocalThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, status: targetStatus } : t))
    );

    // Persist in background, revert on failure
    updateThreadStatusAction({ threadId, status: targetStatus }).then((result) => {
      if (!result.success) {
        setLocalThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, status: previousStatus } : t))
        );
      }
    });
  }

  const grouped = useMemo(() => {
    const map: Record<ThreadStatusValue, ThreadListItem[]> = {
      NEW: [],
      WAITING_REVIEW: [],
      WAITING_CUSTOMER: [],
      ESCALATED: [],
      IN_PROGRESS: [],
      CLOSED: [],
    };
    for (const thread of localThreads) {
      map[thread.status]?.push(thread);
    }
    return map;
  }, [localThreads]);

  return (
    <>
      {/* Refresh toolbar — pinned top-right, overlapping the layout header row */}
      <div className="fixed right-6 top-4 z-10 flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex shrink-0 items-center justify-center rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer">
            Auto: {activeRefreshLabel}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {REFRESH_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => setRefreshInterval(opt.value)}
                className={refreshInterval === opt.value ? "font-semibold" : ""}
              >
                {opt.label === "Off" ? "Off" : `Every ${opt.label}`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          onClick={doRefresh}
          disabled={isRefreshing}
          className="gap-1.5"
        >
          <RefreshCw
            className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="flex h-[calc(100vh-6rem)] overflow-x-auto pb-2">
        {THREAD_STATUSES.map((status) => {
          const items = grouped[status];
          const isDragOver = dragOverColumn === status;
          return (
            <div
              key={status}
              className={`flex w-72 shrink-0 flex-col border-r last:border-r-0 transition-colors ${
                isDragOver ? "bg-accent/30" : ""
              }`}
              onDragOver={handleDragOver}
              onDragEnter={() => setDragOverColumn(status)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverColumn(null);
                }
              }}
              onDrop={(e) => handleDrop(e, status)}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 border-b px-3 pb-2">
                <span className={`text-sm font-semibold ${STATUS_COLOR[status]}`}>
                  {THREAD_STATUS_LABEL[status]}
                </span>
                <span className="text-sm text-muted-foreground">
                  {items.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 overflow-y-auto px-2 pt-2">
                {items.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted-foreground">
                    No threads
                  </div>
                ) : (
                  items.map((thread) => (
                    <div
                      key={thread.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, thread.id)}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <ThreadCard
                        id={thread.id}
                        title={thread.title}
                        summary={thread.summary}
                        customerName={thread.customer.displayName}
                        updatedAt={new Date(thread.updatedAt)}
                        messageCount={thread._count.messages}
                        assigneeName={
                          thread.assignedTo?.name ??
                          thread.assignedTo?.email ??
                          null
                        }
                        selected={selectedId === thread.id}
                        onClick={() => selectThread(thread.id)}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ThreadDetailSheet
        threadId={selectedId}
        onClose={() => selectThread(null)}
      />
    </>
  );
}
