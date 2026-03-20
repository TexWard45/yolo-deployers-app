import { Badge } from "@/components/ui/badge";

interface MessageTimelineItem {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  body: string;
  createdAt: Date;
}

interface MessageTimelineProps {
  messages: MessageTimelineItem[];
}

function directionLabel(direction: MessageTimelineItem["direction"]) {
  if (direction === "INBOUND") return "Customer";
  if (direction === "OUTBOUND") return "Team";
  return "System";
}

export function MessageTimeline({ messages }: MessageTimelineProps) {
  if (messages.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No messages yet for this thread.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <div key={message.id} className="rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <Badge variant={message.direction === "INBOUND" ? "default" : "outline"}>
              {directionLabel(message.direction)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(message.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{message.body}</p>
        </div>
      ))}
    </div>
  );
}
