"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DraftTypeBadge } from "@/components/inbox/DraftTypeBadge";
import { getThreadAnalysis, triggerThreadAnalysis } from "@/actions/inbox";

type Analysis = NonNullable<Awaited<ReturnType<typeof getThreadAnalysis>>>;

interface AnalysisPanelProps {
  threadId: string;
  workspaceId: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800 hover:bg-red-100",
  high: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  medium: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  low: "bg-blue-100 text-blue-800 hover:bg-blue-100",
};

export function AnalysisPanel({ threadId, workspaceId }: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, startTransition] = useTransition();
  const [triggering, startTriggering] = useTransition();

  const fetchAnalysis = useCallback(() => {
    startTransition(async () => {
      const data = await getThreadAnalysis(threadId, workspaceId);
      setAnalysis(data);
    });
  }, [threadId, workspaceId]);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  const handleReanalyze = () => {
    startTriggering(async () => {
      const result = await triggerThreadAnalysis(threadId, workspaceId);
      if (result.success) {
        // Refetch after a short delay to allow workflow to start
        setTimeout(fetchAnalysis, 2000);
      }
    });
  };

  if (loading && !analysis) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          AI Analysis
        </h3>
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          AI Analysis
        </h3>
        <p className="mb-2 text-xs text-muted-foreground">No analysis yet.</p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={triggering}
          onClick={handleReanalyze}
        >
          {triggering ? "Analyzing..." : "Analyze"}
        </Button>
      </div>
    );
  }

  const draft = analysis.drafts[0];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          AI Analysis
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px]"
          disabled={triggering}
          onClick={handleReanalyze}
        >
          {triggering ? "..." : "Re-analyze"}
        </Button>
      </div>

      <div className="space-y-3">
        {/* Classification badges */}
        <div className="flex flex-wrap gap-1.5">
          {analysis.severity ? (
            <Badge className={SEVERITY_STYLES[analysis.severity] ?? "bg-gray-100 text-gray-800 hover:bg-gray-100"}>
              {analysis.severity}
            </Badge>
          ) : null}
          {analysis.issueCategory ? (
            <Badge variant="outline" className="text-[10px]">
              {analysis.issueCategory}
            </Badge>
          ) : null}
          {!analysis.sufficient ? (
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
              Needs info
            </Badge>
          ) : null}
        </div>

        {/* Affected component */}
        {analysis.affectedComponent ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Component:</span> {analysis.affectedComponent}
          </p>
        ) : null}

        {/* Summary */}
        <p className="text-xs leading-relaxed">{analysis.summary}</p>

        {/* RCA */}
        {analysis.rcaSummary ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Root Cause
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {analysis.rcaSummary}
            </p>
          </div>
        ) : null}

        {/* Codex findings */}
        {analysis.codexFindings ? (
          <CodexFindingsSection findings={analysis.codexFindings} />
        ) : null}

        {/* Draft */}
        {draft ? (
          <div className="rounded-md border p-2">
            <div className="mb-1 flex items-center gap-1.5">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Draft Reply
              </p>
              <DraftTypeBadge draftType={draft.draftType} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {draft.body.length > 200 ? `${draft.body.slice(0, 200)}...` : draft.body}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CodexFindingsSection({ findings }: { findings: unknown }) {
  const codex = findings as { chunks?: Array<{ filePath?: string; symbolName?: string; score?: number }> };
  if (!codex.chunks || codex.chunks.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
        Related Code
      </p>
      <div className="space-y-1">
        {codex.chunks.slice(0, 3).map((chunk, i) => (
          <p key={i} className="truncate text-xs font-mono text-muted-foreground">
            {chunk.filePath ?? "unknown"}{chunk.symbolName ? ` (${chunk.symbolName})` : ""}
          </p>
        ))}
      </div>
    </div>
  );
}
