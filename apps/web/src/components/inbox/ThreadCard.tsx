import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThreadStatusBadge } from "@/components/inbox/ThreadStatusBadge";
import type { ThreadStatusValue } from "@/components/inbox/thread-status";

interface ThreadCardProps {
  id: string;
  title: string | null;
  customerName: string;
  status: ThreadStatusValue;
  messageCount: number;
  updatedAt: Date;
}

export function ThreadCard({
  id,
  title,
  customerName,
  status,
  messageCount,
  updatedAt,
}: ThreadCardProps) {
  return (
    <Card className="transition-colors hover:bg-muted/40">
      <Link href={`/inbox/${id}`} className="block">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">
              {title ?? `Thread with ${customerName}`}
            </CardTitle>
            <ThreadStatusBadge status={status} />
          </div>
          <p className="text-xs text-muted-foreground">{customerName}</p>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{messageCount} message{messageCount === 1 ? "" : "s"}</span>
          <span>{updatedAt.toLocaleString()}</span>
        </CardContent>
      </Link>
    </Card>
  );
}
