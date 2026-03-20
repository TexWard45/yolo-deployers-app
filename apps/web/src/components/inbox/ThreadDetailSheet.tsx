"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ThreadStatusBadge } from "@/components/inbox/ThreadStatusBadge";
import { StatusActions } from "@/components/inbox/StatusActions";
import { getThreadDetail } from "@/actions/inbox";
import type { ThreadStatusValue } from "@/components/inbox/thread-status";

interface ThreadMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  body: string;
  createdAt: Date;
}

interface ThreadData {
  id: string;
  title: string | null;
  status: ThreadStatusValue;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    displayName: string;
    email: string | null;
    source: "DISCORD" | "MANUAL" | "API";
  };
  assignedTo?: {
    name: string | null;
    email: string;
  } | null;
  messages: ThreadMessage[];
}

interface ThreadDetailSheetProps {
  threadId: string | null;
  onClose: () => void;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ThreadDetailSheet({ threadId, onClose }: ThreadDetailSheetProps) {
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    if (!threadId) {
      setThread(null);
      return;
    }
    startTransition(async () => {
      const data = await getThreadDetail(threadId);
      setThread(data as ThreadData | null);
    });
  }, [threadId]);

  return (
    <Sheet
      open={threadId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : thread ? (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-3 pr-8">
                <SheetTitle className="text-base leading-snug">
                  {thread.title ?? `Thread with ${thread.customer.displayName}`}
                </SheetTitle>
                <ThreadStatusBadge status={thread.status} />
              </div>
              <SheetDescription>
                {thread.customer.displayName}
                {thread.customer.email ? ` · ${thread.customer.email}` : ""}
                {" · "}
                {thread.customer.source}
              </SheetDescription>
            </SheetHeader>

            {/* Status actions */}
            <div className="px-4 pb-2">
              <StatusActions threadId={thread.id} currentStatus={thread.status} />
            </div>

            {/* Messages */}
            <div className="flex flex-col gap-2 px-4 pb-4">
              <h3 className="text-sm font-semibold">
                Messages ({thread.messages.length})
              </h3>
              {thread.messages.length === 0 ? (
                <p className="text-xs text-muted-foreground">No messages yet.</p>
              ) : (
                thread.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-lg border p-3 ${
                      msg.direction === "INBOUND"
                        ? "border-l-2 border-l-blue-500"
                        : msg.direction === "OUTBOUND"
                          ? "border-l-2 border-l-emerald-500"
                          : "border-l-2 border-l-muted-foreground bg-muted/30"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <Badge
                        variant={
                          msg.direction === "INBOUND"
                            ? "default"
                            : msg.direction === "OUTBOUND"
                              ? "secondary"
                              : "outline"
                        }
                        className="text-[10px]"
                      >
                        {msg.direction === "INBOUND"
                          ? "Customer"
                          : msg.direction === "OUTBOUND"
                            ? "Team"
                            : "System"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(new Date(msg.createdAt))}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{msg.body}</p>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-muted-foreground">Thread not found.</span>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
