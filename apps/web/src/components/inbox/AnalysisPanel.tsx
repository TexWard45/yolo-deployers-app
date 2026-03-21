"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DraftTypeBadge } from "@/components/inbox/DraftTypeBadge";
import {
  getThreadAnalysis,
  triggerThreadAnalysis,
  approveDraftAction,
  dismissDraftAction,
} from "@/actions/inbox";
import { SentryFindings } from "@/components/inbox/SentryFindings";
import { TriageSection } from "@/components/inbox/TriageSection";

export interface AnalysisDraft {
  id: string;
  body: string;
  draftType: string;
  status: string;
}

interface Analysis {
  id: string;
  severity: string | null;
  issueCategory: string | null;
  affectedComponent: string | null;
  summary: string;
  rcaSummary: string | null;
  sufficient: boolean;
  codexFindings: unknown;
  sentryFindings: unknown;
  drafts: AnalysisDraft[];
}

interface AnalysisPanelProps {
  threadId: string;
  workspaceId: string;
  onDraftAvailable?: (draft: AnalysisDraft | null) => void;
  refreshRef?: React.RefObject<(() => void) | null>;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800 hover:bg-red-100",
  high: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  medium: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  low: "bg-blue-100 text-blue-800 hover:bg-blue-100",
};

export function AnalysisPanel({ threadId, workspaceId, onDraftAvailable, refreshRef }: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, startTransition] = useTransition();
  const [triggering, startTriggering] = useTransition();
  const hasAnalysisRef = useRef(false);

  const fetchAnalysis = useCallback(() => {
    startTransition(async () => {
      const data = await getThreadAnalysis(threadId, workspaceId);
      const result = data as Analysis | null;
      setAnalysis(result);
      hasAnalysisRef.current = result !== null;
      const draft = result?.drafts[0] ?? null;
      onDraftAvailable?.(draft);
    });
  }, [threadId, workspaceId, onDraftAvailable]);

  // Expose refresh to parent
  useEffect(() => {
    if (refreshRef) {
      refreshRef.current = fetchAnalysis;
    }
  }, [refreshRef, fetchAnalysis]);

  // Fetch on mount + poll every 10s until analysis arrives
  useEffect(() => {
    fetchAnalysis();

    // Poll while no analysis — workflow takes ~60s+ to complete
    const interval = setInterval(() => {
      if (!hasAnalysisRef.current) {
        fetchAnalysis();
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [fetchAnalysis]);

  const handleReanalyze = () => {
    setAnalysis(null);
    hasAnalysisRef.current = false; // Reset to resume polling
    startTriggering(async () => {
      const result = await triggerThreadAnalysis(threadId, workspaceId);
      if (result.success) {
        // Polling will pick up the result automatically
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
        {triggering ? (
          <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-xs font-medium text-primary">Running analysis...</span>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {loading ? "Checking..." : "No analysis yet."}
            </p>
            <Button
              size="sm"
              className="h-8 w-full gap-1.5 text-xs"
              onClick={handleReanalyze}
            >
              Trigger Analysis
            </Button>
          </>
        )}
        {hasAnalysisRef.current === false && !triggering ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Auto-refreshing every 10s
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          AI Analysis
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          disabled={triggering}
          onClick={handleReanalyze}
        >
          {triggering ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Analyzing...
            </>
          ) : (
            "Re-analyze"
          )}
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

        {/* Sentry findings */}
        {analysis.sentryFindings ? (
          <SentryFindings findings={analysis.sentryFindings} />
        ) : null}

        {/* Triage section */}
        {analysis.sufficient ? (
          <TriageSection
            threadId={threadId}
            workspaceId={workspaceId}
            analysisId={analysis.id}
          />
        ) : null}
      </div>
    </div>
  );
}

export interface DraftChatBubbleProps {
  draft: AnalysisDraft;
  workspaceId: string;
  onDraftActioned: () => void;
}

export function DraftChatBubble({ draft, workspaceId, onDraftActioned }: DraftChatBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(draft.body);
  const [approving, startApproving] = useTransition();
  const [dismissing, startDismissing] = useTransition();

  const handleSend = () => {
    startApproving(async () => {
      const result = await approveDraftAction({
        draftId: draft.id,
        workspaceId,
      });
      if (result.success) {
        onDraftActioned();
      } else {
        console.error("[DraftChatBubble] send failed:", result.error);
        alert(`Failed to send: ${result.error}`);
      }
    });
  };

  const handleDismiss = () => {
    startDismissing(async () => {
      const result = await dismissDraftAction({
        draftId: draft.id,
        workspaceId,
      });
      if (result.success) {
        onDraftActioned();
      }
    });
  };

  const busy = approving || dismissing;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
          AI
        </span>
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">
          Draft Reply
        </p>
        <DraftTypeBadge draftType={draft.draftType} />
      </div>

      {/* Chat bubble */}
      <div className="rounded-lg border border-l-2 border-l-violet-400 bg-violet-50/50 p-3 dark:bg-violet-950/20">
        {editing ? (
          <textarea
            className="w-full resize-none rounded border bg-background px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
            rows={5}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            autoFocus
          />
        ) : (
          <p className="whitespace-pre-wrap text-xs leading-relaxed">
            {draft.body}
          </p>
        )}
      </div>

      {/* Action buttons */}
      {draft.status === "GENERATED" ? (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700"
            disabled={busy}
            onClick={handleSend}
          >
            {approving ? "Sending..." : "Send"}
          </Button>
          {editing ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEditing(false)}
            >
              Done
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => {
                setEditBody(draft.body);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive"
            disabled={busy}
            onClick={handleDismiss}
          >
            {dismissing ? "..." : "Delete"}
          </Button>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          {draft.status === "APPROVED" ? "Sent" : "Dismissed"}
        </p>
      )}
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
