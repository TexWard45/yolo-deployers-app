"use client";

import { useEffect, useMemo, useState } from "react";
import { ThreadCard } from "@/components/inbox/ThreadCard";
import { ThreadDetailSheet } from "@/components/inbox/ThreadDetailSheet";
import { updateThreadStatusAction } from "@/actions/inbox";
import {
  THREAD_STATUSES,
  THREAD_STATUS_LABEL,
  type ThreadStatusValue,
} from "@/components/inbox/thread-status";

interface ThreadListItem {
  id: string;
  title: string | null;
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
  const [localThreads, setLocalThreads] = useState(threads);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ThreadStatusValue | null>(null);

  // Sync when server re-renders with fresh data
  useEffect(() => {
    setLocalThreads(threads);
  }, [threads]);

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

    // Optimistic: move the card immediately
    setLocalThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, status: targetStatus } : t))
    );

    // Persist in background
    updateThreadStatusAction({ threadId, status: targetStatus });
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
                        customerName={thread.customer.displayName}
                        updatedAt={new Date(thread.updatedAt)}
                        assigneeName={
                          thread.assignedTo?.name ??
                          thread.assignedTo?.email ??
                          null
                        }
                        selected={selectedId === thread.id}
                        onClick={() => setSelectedId(thread.id)}
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
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
