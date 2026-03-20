interface ThreadCardProps {
  id: string;
  title: string | null;
  customerName: string;
  updatedAt: Date;
  assigneeName: string | null;
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
  customerName,
  updatedAt,
  assigneeName,
  selected,
  onClick,
}: ThreadCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/40 ${
        selected ? "border-primary bg-accent/30" : "bg-background"
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

      {/* Footer */}
      <div className="mt-2.5 flex items-center text-[11px] text-muted-foreground">
        {assigneeName ? (
          <span
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground"
            title={assigneeName}
          >
            {getInitial(assigneeName)}
          </span>
        ) : null}
        <span className="ml-1.5">
          &bull; {timeAgo(updatedAt)}
        </span>
      </div>
    </button>
  );
}
