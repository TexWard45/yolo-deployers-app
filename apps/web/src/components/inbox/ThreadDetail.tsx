import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThreadStatusBadge } from "@/components/inbox/ThreadStatusBadge";
import { MessageTimeline } from "@/components/inbox/MessageTimeline";
import { StatusActions } from "@/components/inbox/StatusActions";
import type { ThreadStatusValue } from "@/components/inbox/thread-status";

interface ThreadDetailProps {
  thread: {
    id: string;
    title: string | null;
    summary: string | null;
    status: ThreadStatusValue;
    createdAt: Date;
    updatedAt: Date;
    customer: {
      displayName: string;
      email: string | null;
      source: "DISCORD" | "MANUAL" | "API";
    };
    messages: Array<{
      id: string;
      direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
      body: string;
      createdAt: Date;
    }>;
  };
}

export function ThreadDetail({ thread }: ThreadDetailProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{thread.title ?? `Thread with ${thread.customer.displayName}`}</CardTitle>
            <ThreadStatusBadge status={thread.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Customer: {thread.customer.displayName}
            {thread.customer.email ? ` (${thread.customer.email})` : ""}
          </p>
          {thread.summary ? (
            <p className="text-sm text-muted-foreground">Summary: {thread.summary}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Source: {thread.customer.source} • Updated {new Date(thread.updatedAt).toLocaleString()}
          </p>
        </CardHeader>
        <CardContent>
          <StatusActions threadId={thread.id} currentStatus={thread.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messages</CardTitle>
        </CardHeader>
        <CardContent>
          <MessageTimeline messages={thread.messages} />
        </CardContent>
      </Card>
    </div>
  );
}
