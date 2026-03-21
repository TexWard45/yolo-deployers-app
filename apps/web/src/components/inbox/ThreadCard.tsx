const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  high: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  medium: "border-primary/20 bg-primary/10 text-primary",
  low: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

interface ThreadCardProps {
  id: string;
  title: string | null;
  summary: string | null;
  customerName: string;
  updatedAt: Date;
  messageCount: number;
  assigneeName: string | null;
  linearIssueId?: string | null;
  linearIssueUrl?: string | null;
  severity: string | null;
  issueCategory: string | null;
  selected: boolean;
  onClick: () => void;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days === 1 ? "1 day" : `${days} days`} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks === 1 ? "1 week" : `${weeks} weeks`} ago`;
}

function getInitial(name: string): string {
  return (name[0] ?? "?").toUpperCase();
}

export function ThreadCard({
  title,
  summary,
  customerName,
  updatedAt,
  messageCount,
  assigneeName,
  linearIssueId,
  linearIssueUrl,
  severity,
  issueCategory,
  selected,
  onClick,
}: ThreadCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg border p-3 text-left transition-all ${
        selected ? "border-primary/40 bg-primary/5 shadow-sm" : "bg-card/80 hover:bg-muted/30 hover:border-border"
      }`}
    >
      {/* Customer row */}
      <div className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-bold text-primary">
          {getInitial(customerName)}
        </span>
        <span className="truncate text-xs font-semibold">{customerName}</span>
      </div>

      {/* Title */}
      <p className="mt-1.5 text-sm leading-snug line-clamp-2">
        {title ?? `Thread with ${customerName}`}
      </p>

      {/* Analysis labels */}
      {(severity || issueCategory) ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {severity ? (
            <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_COLORS[severity] ?? "bg-muted text-muted-foreground"}`}>
              {severity}
            </span>
          ) : null}
          {issueCategory ? (
            <span className="inline-block rounded-full border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {issueCategory}
            </span>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {summary}
        </p>
      ) : null}

      {/* Footer */}
      <div className="mt-2.5 flex items-center text-[11px] tabular-nums text-muted-foreground">
        {assigneeName ? (
          <span
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground"
            title={assigneeName}
          >
            {getInitial(assigneeName)}
          </span>
        ) : null}
        <span className="ml-1.5">
          {messageCount} msgs &bull; {timeAgo(updatedAt)}
        </span>
        {linearIssueId && linearIssueUrl ? (
          <a
            href={linearIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50"
          >
            {linearIssueId}
          </a>
        ) : null}
      </div>
    </button>
  );
}
