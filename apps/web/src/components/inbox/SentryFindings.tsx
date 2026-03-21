"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";

interface SentryFinding {
  issueId: string;
  title: string;
  culprit: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  level: string;
  stackTrace: string | null;
}

interface SentryFindingsProps {
  findings: unknown;
}

const LEVEL_STYLES: Record<string, string> = {
  fatal: "bg-red-100 text-red-800",
  error: "bg-red-100 text-red-800",
  warning: "bg-yellow-100 text-yellow-800",
  info: "bg-blue-100 text-blue-800",
};

export function SentryFindings({ findings }: SentryFindingsProps) {
  const items = findings as SentryFinding[] | null;
  if (!items || !Array.isArray(items) || items.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
        Sentry Errors
      </p>
      <div className="space-y-2">
        {items.slice(0, 5).map((finding) => (
          <SentryCard key={finding.issueId} finding={finding} />
        ))}
      </div>
    </div>
  );
}

function SentryCard({ finding }: { finding: SentryFinding }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{finding.title}</p>
          {finding.culprit ? (
            <p className="truncate text-[10px] font-mono text-muted-foreground">
              {finding.culprit}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge className={`text-[9px] ${LEVEL_STYLES[finding.level] ?? "bg-gray-100 text-gray-800"}`}>
            {finding.count.toLocaleString()}x
          </Badge>
        </div>
      </div>

      {finding.stackTrace ? (
        <div className="mt-1">
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide" : "Show"} stacktrace
          </button>
          {expanded ? (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[10px] leading-relaxed">
              {finding.stackTrace}
            </pre>
          ) : null}
        </div>
      ) : null}

      <p className="mt-1 text-[9px] text-muted-foreground">
        Last seen: {new Date(finding.lastSeen).toLocaleDateString()}
      </p>
    </div>
  );
}
