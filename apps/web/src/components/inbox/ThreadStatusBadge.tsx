import { Badge } from "@/components/ui/badge";
import { THREAD_STATUS_LABEL, type ThreadStatusValue } from "./thread-status";

interface ThreadStatusBadgeProps {
  status: ThreadStatusValue;
}

export function ThreadStatusBadge({ status }: ThreadStatusBadgeProps) {
  if (status === "ESCALATED") {
    return <Badge variant="destructive">{THREAD_STATUS_LABEL[status]}</Badge>;
  }
  if (status === "CLOSED") {
    return <Badge variant="secondary">{THREAD_STATUS_LABEL[status]}</Badge>;
  }
  return <Badge variant="outline">{THREAD_STATUS_LABEL[status]}</Badge>;
}
