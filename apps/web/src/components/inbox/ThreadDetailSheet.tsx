"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ThreadStatusBadge } from "@/components/inbox/ThreadStatusBadge";
import { getThreadDetail, sendReply } from "@/actions/inbox";
import {
  getDefaultReplySegmentId,
  getReplyToExternalMessageId,
  groupMessagesIntoSegments,
} from "@/components/inbox/message-segments";

type ThreadData = NonNullable<Awaited<ReturnType<typeof getThreadDetail>>>;

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

function getInitial(name: string): string {
  return (name[0] ?? "?").toUpperCase();
}

function ThreadSheetContent({ threadId }: { threadId: string }) {
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [loading, startTransition] = useTransition();
  const [replyBody, setReplyBody] = useState("");
  const [sending, startSending] = useTransition();
  const [activeReplySegmentId, setActiveReplySegmentId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback((id: string) => {
    startTransition(async () => {
      const data = await getThreadDetail(id);
      setThread(data);
    });
  }, []);

  useEffect(() => {
    fetchThread(threadId);
  }, [threadId, fetchThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length]);

  const segments = useMemo(() => {
    if (!thread) return [];
    return groupMessagesIntoSegments(
      thread.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        createdAt: new Date(message.createdAt),
        externalMessageId: message.externalMessageId,
        inReplyToExternalMessageId: message.inReplyToExternalMessageId,
      })),
    );
  }, [thread]);

  const effectiveActiveReplySegmentId =
    activeReplySegmentId ?? getDefaultReplySegmentId(segments);

  const activeSegment =
    segments.find((segment) => segment.id === effectiveActiveReplySegmentId) ?? null;
  const replyToExternalMessageId = getReplyToExternalMessageId(activeSegment);

  function handleSendReply() {
    const body = replyBody.trim();
    if (!body) return;

    startSending(async () => {
      const result = await sendReply({
        threadId,
        body,
        inReplyToExternalMessageId: replyToExternalMessageId,
      });
      if (result.success) {
        setReplyBody("");
        fetchThread(threadId);
      }
    });
  }

  if (loading && !thread) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">Thread not found.</span>
      </div>
    );
  }

  return (
    <>
      <SheetHeader className="shrink-0 border-b">
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

      <div className="flex min-h-0 flex-1">
        {/* Left: Chat panel */}
        <div className="flex flex-1 flex-col border-r">
          {/* Messages - scrollable */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {thread.messages.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                No messages yet.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {segments.map((segment, index) => (
                  <div
                    key={segment.id}
                    className={`rounded-lg border ${
                      effectiveActiveReplySegmentId === segment.id
                        ? "border-primary bg-accent/20"
                        : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between border-b px-3 py-2 text-left"
                      onClick={() => setActiveReplySegmentId(segment.id)}
                    >
                      <span className="text-xs font-semibold">
                        Thread {index + 1}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {segment.messages.length} msgs
                      </span>
                    </button>
                    <div className="space-y-3 px-3 py-3">
                      {segment.messages.map((msg) => {
                        const isInbound = msg.direction === "INBOUND";
                        const isOutbound = msg.direction === "OUTBOUND";
                        return (
                          <div key={msg.id} className="flex gap-2.5">
                            <span
                              className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                isInbound
                                  ? "bg-blue-100 text-blue-700"
                                  : isOutbound
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {isInbound
                                ? getInitial(thread.customer.displayName)
                                : isOutbound
                                  ? "T"
                                  : "S"}
                            </span>

                            <div className="flex-1">
                              <div className="mb-0.5 flex items-center gap-2">
                                <span className="text-xs font-semibold">
                                  {isInbound
                                    ? thread.customer.displayName
                                    : isOutbound
                                      ? "Team"
                                      : "System"}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {timeAgo(new Date(msg.createdAt))}
                                </span>
                              </div>
                              <div
                                className={`rounded-lg border p-3 ${
                                  isInbound
                                    ? "border-l-2 border-l-blue-500"
                                    : isOutbound
                                      ? "border-l-2 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
                                      : "border-l-2 border-l-muted-foreground bg-muted/30"
                                }`}
                              >
                                <p className="whitespace-pre-wrap text-sm">
                                  {msg.body}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Reply bar - pinned at bottom */}
          <div className="shrink-0 border-t p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              Reply to{" "}
              <span className="font-semibold text-foreground">
                {activeSegment?.label ?? "latest thread"}
              </span>
            </p>
            <div className="flex gap-2">
              <textarea
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Write a reply..."
                rows={2}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleSendReply();
                  }
                }}
              />
              <Button
                size="sm"
                className="self-end"
                disabled={sending || !replyBody.trim()}
                onClick={handleSendReply}
              >
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Press Cmd+Enter to send
            </p>
          </div>
        </div>

        {/* Right: Details sidebar */}
        <div className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto p-4">
          {/* Status */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Status
            </h3>
            <ThreadStatusBadge status={thread.status} />
          </div>

          {/* Customer Info */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Customer
            </h3>
            <div className="space-y-1 text-sm">
              <p className="font-medium">{thread.customer.displayName}</p>
              {thread.customer.email ? (
                <p className="text-muted-foreground">{thread.customer.email}</p>
              ) : null}
              <p className="text-muted-foreground">
                Source: {thread.customer.source}
              </p>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Assigned To
            </h3>
            <p className="text-sm text-muted-foreground">
              {thread.assignedTo
                ? thread.assignedTo.name ?? thread.assignedTo.email
                : "Unassigned"}
            </p>
          </div>

          {/* Summary */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Summary
            </h3>
            <p className="text-sm text-muted-foreground">
              {thread.summary ?? "No summary yet."}
            </p>
          </div>

          {/* Timestamps */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Details
            </h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Created: {new Date(thread.createdAt).toLocaleString()}</p>
              <p>Updated: {new Date(thread.updatedAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function ThreadDetailSheet({
  threadId,
  onClose,
}: ThreadDetailSheetProps) {
  return (
    <Sheet
      open={threadId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="!w-[80vw] !max-w-[80vw] overflow-hidden"
      >
        {threadId ? (
          <ThreadSheetContent key={threadId} threadId={threadId} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
