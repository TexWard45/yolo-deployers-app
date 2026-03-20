"use client";

import { useMemo, useState } from "react";
import { ThreadCard } from "@/components/inbox/ThreadCard";
import { ThreadFilters } from "@/components/inbox/ThreadFilters";
import type { ThreadStatusValue } from "@/components/inbox/thread-status";

interface ThreadListItem {
  id: string;
  title: string | null;
  status: ThreadStatusValue;
  updatedAt: Date;
  customer: {
    displayName: string;
  };
  _count: {
    messages: number;
  };
}

interface ThreadListProps {
  threads: ThreadListItem[];
}

export function ThreadList({ threads }: ThreadListProps) {
  const [filter, setFilter] = useState<ThreadStatusValue | "ALL">("ALL");

  const filtered = useMemo(() => {
    if (filter === "ALL") return threads;
    return threads.filter((thread) => thread.status === filter);
  }, [filter, threads]);

  return (
    <div className="space-y-4">
      <ThreadFilters value={filter} onChange={setFilter} />

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No threads found for this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((thread) => (
            <ThreadCard
              key={thread.id}
              id={thread.id}
              title={thread.title}
              customerName={thread.customer.displayName}
              status={thread.status}
              messageCount={thread._count.messages}
              updatedAt={new Date(thread.updatedAt)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
