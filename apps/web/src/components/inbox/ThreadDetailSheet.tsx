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
import { renderMessageBody, type MentionsMap, type AttachmentInfo } from "@/components/inbox/render-message-body";
import { getThreadDetail, sendReply, getWorkspaceMembers, assignThreadAction } from "@/actions/inbox";
import { AnalysisPanel, DraftChatBubble, type AnalysisDraft } from "@/components/inbox/AnalysisPanel";
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
  const [inlineReplyDrafts, setInlineReplyDrafts] = useState<Record<string, string>>({});
  const [openInlineReplySegmentId, setOpenInlineReplySegmentId] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [activeReplySegmentId, setActiveReplySegmentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnalysisDraft | null>(null);
  const analysisRefreshRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [members, setMembers] = useState<Array<{ id: string; name: string | null; email: string; role: string }>>([]);
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [assigning, startAssigning] = useTransition();
  const assignDropdownRef = useRef<HTMLDivElement>(null);

  const handleDraftAvailable = useCallback((d: AnalysisDraft | null) => {
    setDraft(d);
  }, []);

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

  // Fetch workspace members for the assignment dropdown
  useEffect(() => {
    if (thread?.workspaceId) {
      getWorkspaceMembers(thread.workspaceId).then(setMembers);
    }
  }, [thread?.workspaceId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(e.target as Node)) {
        setAssignDropdownOpen(false);
      }
    }
    if (assignDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [assignDropdownOpen]);

  function handleAssign(userId: string | null) {
    startAssigning(async () => {
      const result = await assignThreadAction({
        threadId,
        assignedToId: userId,
      });
      if (result.success) {
        fetchThread(threadId);
      }
      setAssignDropdownOpen(false);
      setAssignSearch("");
    });
  }

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
        metadata: message.metadata as Record<string, unknown> | null,
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

  function handleOpenInlineReply(segmentId: string) {
    setActiveReplySegmentId(segmentId);
    setOpenInlineReplySegmentId(segmentId);
  }

  function handleInlineDraftChange(segmentId: string, value: string) {
    setInlineReplyDrafts((prev) => ({
      ...prev,
      [segmentId]: value,
    }));
  }

  function handleSendInlineReply(segmentId: string) {
    const segment = segments.find((item) => item.id === segmentId) ?? null;
    const body = (inlineReplyDrafts[segmentId] ?? "").trim();
    if (!segment || !body) return;

    const inReplyToExternalMessageId = getReplyToExternalMessageId(segment);

    startSending(async () => {
      const result = await sendReply({
        threadId,
        body,
        inReplyToExternalMessageId,
      });

      if (result.success) {
        setInlineReplyDrafts((prev) => ({
          ...prev,
          [segmentId]: "",
        }));
        setOpenInlineReplySegmentId(null);
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
          {/* ── Thread messages — ~65% height, scrolls independently ── */}
          <div className="min-h-0 flex-[7] overflow-y-auto px-4 py-3">
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
                        ? "border-primary/40 bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between border-b px-3 py-1.5">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setActiveReplySegmentId(segment.id)}
                      >
                        <span className="text-xs font-semibold">
                          Thread {index + 1}
                        </span>
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {segment.messages.length} msgs
                        </span>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px]"
                          onClick={() => handleOpenInlineReply(segment.id)}
                        >
                          Reply
                        </Button>
                      </div>
                    </div>
                    <div className="px-3 py-2.5">
                      {segment.messages.map((msg, msgIdx) => {
                        const isInbound = msg.direction === "INBOUND";
                        const isOutbound = msg.direction === "OUTBOUND";
                        const isRoot = msgIdx === 0;
                        const isReply = !isRoot;
                        const hasReplies = msgIdx === 0 && segment.messages.length > 1;
                        const isLastReply = msgIdx === segment.messages.length - 1 && isReply;

                        return (
                          <div key={msg.id} className={isReply ? "relative ml-8" : ""}>
                            {isReply ? (
                              <>
                                <div className="absolute -left-4 -top-3 bottom-0 w-px bg-border" style={isLastReply ? { bottom: "50%" } : undefined} />
                                <div className="absolute -left-4 top-4 h-px w-4 bg-border" />
                              </>
                            ) : null}
                            {hasReplies ? (
                              <div className="absolute left-[13px] top-9 h-[calc(100%-36px)] w-px bg-border" style={{ zIndex: 0 }} />
                            ) : null}

                            <div className={`relative flex gap-2.5 ${isReply ? "pt-2.5" : ""}`}>
                              <span
                                className={`relative z-10 mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                  isInbound
                                    ? "bg-primary/10 text-primary"
                                    : isOutbound
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {isInbound
                                  ? getInitial(thread.customer.displayName)
                                  : isOutbound
                                    ? "T"
                                    : "S"}
                              </span>

                              <div className="flex-1 min-w-0">
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
                                  className={`rounded-lg border p-2.5 ${
                                    isInbound
                                      ? "border-l-2 border-l-primary"
                                      : isOutbound
                                        ? "border-l-2 border-l-emerald-500 bg-emerald-500/5"
                                        : "border-l-2 border-l-muted-foreground bg-muted/30"
                                  }`}
                                >
                                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                                    {renderMessageBody(
                                      msg.body,
                                      (msg.metadata as Record<string, unknown> | null)?.mentions as MentionsMap | undefined,
                                      (msg.metadata as Record<string, unknown> | null)?.attachments as AttachmentInfo[] | undefined,
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {openInlineReplySegmentId === segment.id ? (
                      <div className="border-t px-3 py-2">
                        <p className="mb-1 text-[10px] text-muted-foreground">
                          Reply directly in {segment.label}
                        </p>
                        <div className="flex gap-2">
                          <textarea
                            className="flex-1 resize-none rounded-md border bg-background/50 px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            placeholder="Write a reply..."
                            rows={2}
                            value={inlineReplyDrafts[segment.id] ?? ""}
                            onChange={(e) => handleInlineDraftChange(segment.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                handleSendInlineReply(segment.id);
                              }
                            }}
                          />
                          <div className="flex flex-col gap-1">
                            <Button
                              type="button"
                              size="xs"
                              disabled={sending || !(inlineReplyDrafts[segment.id] ?? "").trim()}
                              onClick={() => handleSendInlineReply(segment.id)}
                            >
                              {sending ? "..." : "Send"}
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              disabled={sending}
                              onClick={() => setOpenInlineReplySegmentId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* ── Bottom panel: AI Draft + Reply — ~35% max, pinned at bottom ── */}
          <div className="flex shrink-0 flex-col border-t bg-muted/20" style={{ maxHeight: "35%" }}>
            {/* AI Draft suggestion — collapsible, scrollable if long */}
            {draft && draft.status === "GENERATED" ? (
              <div className="max-h-40 overflow-y-auto border-b bg-violet-500/5 px-4 py-2.5">
                <DraftChatBubble
                  draft={draft}
                  workspaceId={thread.workspaceId}
                  onDraftActioned={() => {
                    setDraft(null);
                    analysisRefreshRef.current?.();
                    fetchThread(threadId);
                  }}
                />
              </div>
            ) : null}

            {/* Reply bar — compact, always visible */}
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <textarea
                    className="w-full resize-none rounded-lg border bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                    placeholder={`Reply to ${activeSegment?.label ?? "latest thread"}...`}
                    rows={1}
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleSendReply();
                      }
                    }}
                    style={{ fieldSizing: "content", maxHeight: "6rem" } as React.CSSProperties}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={sending || !replyBody.trim()}
                  onClick={handleSendReply}
                >
                  {sending ? "..." : "Send"}
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                <kbd className="rounded border px-1 py-0.5 text-[9px]">Cmd+Enter</kbd> to send
              </p>
            </div>
          </div>
        </div>

        {/* Right: Details sidebar */}
        <div className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto p-4">
          {/* Status */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </h3>
            <ThreadStatusBadge status={thread.status} />
          </div>

          {/* Customer Info */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
          <div ref={assignDropdownRef}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Assigned To
            </h3>
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                onClick={() => setAssignDropdownOpen(!assignDropdownOpen)}
                disabled={assigning}
              >
                <span className={thread.assignedTo ? "text-foreground" : "text-muted-foreground"}>
                  {assigning
                    ? "Updating..."
                    : thread.assignedTo
                      ? thread.assignedTo.name ?? thread.assignedTo.email
                      : "Unassigned"}
                </span>
                <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {assignDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover shadow-md">
                  <div className="p-2">
                    <input
                      type="text"
                      className="w-full rounded-md border px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Search members..."
                      value={assignSearch}
                      onChange={(e) => setAssignSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {/* Unassign option */}
                    {thread.assignedTo && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                        onClick={() => handleAssign(null)}
                      >
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed text-[9px] text-muted-foreground">
                          -
                        </span>
                        <span className="text-muted-foreground">Unassign</span>
                      </button>
                    )}
                    {members
                      .filter((m) => {
                        if (!assignSearch) return true;
                        const q = assignSearch.toLowerCase();
                        return (
                          (m.name?.toLowerCase().includes(q) ?? false) ||
                          m.email.toLowerCase().includes(q)
                        );
                      })
                      .map((m) => {
                        const isCurrentAssignee = thread.assignedTo?.id === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent ${
                              isCurrentAssignee ? "bg-accent/50" : ""
                            }`}
                            onClick={() => handleAssign(m.id)}
                          >
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                              {getInitial(m.name ?? m.email)}
                            </span>
                            <span className="flex-1 truncate">
                              {m.name ?? m.email}
                            </span>
                            {isCurrentAssignee && (
                              <svg className="h-3 w-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    {members.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        No members found
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </h3>
            <p className="text-sm text-muted-foreground">
              {thread.summary ?? "No summary yet."}
            </p>
          </div>

          {/* AI Analysis */}
          <AnalysisPanel
            threadId={thread.id}
            workspaceId={thread.workspaceId}
            onDraftAvailable={handleDraftAvailable}
            refreshRef={analysisRefreshRef}
          />

          {/* Timestamps */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
