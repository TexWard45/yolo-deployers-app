"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  triageToLinearAction,
  getTriageStatusAction,
  generateSpecAction,
  generateFixPRAction,
  getFixPRStatusAction,
  cancelFixPRAction,
  type FixPRStatusResult,
} from "@/actions/inbox";

interface TriageHistory {
  id: string;
  action: string;
  linearIssueId: string | null;
  linearIssueUrl: string | null;
  prUrl?: string | null;
  specMarkdown: string | null;
  createdBy: string;
  createdAt: string;
}

interface TriageSectionProps {
  threadId: string;
  workspaceId: string;
  analysisId: string;
}

export function TriageSection({ threadId, workspaceId, analysisId }: TriageSectionProps) {
  const [linearIssueId, setLinearIssueId] = useState<string | null>(null);
  const [linearIssueUrl, setLinearIssueUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<TriageHistory[]>([]);
  const [specMarkdown, setSpecMarkdown] = useState<string | null>(null);
  const [fixPrStatus, setFixPrStatus] = useState<FixPRStatusResult | null>(null);
  const [triaging, startTriaging] = useTransition();
  const [generating, startGenerating] = useTransition();
  const [creatingFixPr, startCreatingFixPr] = useTransition();
  const [cancellingFixPr, startCancellingFixPr] = useTransition();
  const [copied, setCopied] = useState(false);
  const isFixRunActive = fixPrStatus ? isActiveFixPrStatus(fixPrStatus.status) : false;

  useEffect(() => {
    let cancelled = false;
    loadTriageSectionState(threadId, workspaceId).then(({ triageResult, fixPrResult }) => {
      if (cancelled) return;
      applyTriageSectionState({
        triageResult,
        fixPrResult,
        setLinearIssueId,
        setLinearIssueUrl,
        setHistory,
        setFixPrStatus,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, workspaceId]);

  useEffect(() => {
    if (!isFixRunActive) {
      return;
    }

    const interval = setInterval(async () => {
      const result = await getFixPRStatusAction(threadId, workspaceId);
      if (result) {
        setFixPrStatus(result);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isFixRunActive, threadId, workspaceId]);

  const refreshStatus = async () => {
    const { triageResult, fixPrResult } = await loadTriageSectionState(threadId, workspaceId);
    applyTriageSectionState({
      triageResult,
      fixPrResult,
      setLinearIssueId,
      setLinearIssueUrl,
      setHistory,
      setFixPrStatus,
    });
  };

  const handleTriage = () => {
    startTriaging(async () => {
      const result = await triageToLinearAction({
        threadId,
        workspaceId,
        analysisId,
      });
      if (result.success) {
        setLinearIssueId(result.linearIssueId ?? null);
        setLinearIssueUrl(result.linearIssueUrl ?? null);
        await refreshStatus();
      } else {
        alert(result.error);
      }
    });
  };

  const handleGenerateSpec = () => {
    startGenerating(async () => {
      const result = await generateSpecAction({
        threadId,
        workspaceId,
        linearIssueId: linearIssueId ?? undefined,
      });
      if (result.success) {
        setSpecMarkdown(result.specMarkdown ?? null);
        await refreshStatus();
      } else {
        alert(result.error);
      }
    });
  };

  const handleGenerateFixPr = () => {
    startCreatingFixPr(async () => {
      const result = await generateFixPRAction({
        threadId,
        workspaceId,
        analysisId,
      });

      if (result.success) {
        await refreshStatus();
      } else {
        alert(result.error);
      }
    });
  };

  const handleCancelFixPr = () => {
    if (!fixPrStatus) return;

    startCancellingFixPr(async () => {
      const result = await cancelFixPRAction({
        runId: fixPrStatus.runId,
        workspaceId,
      });

      if (result.success) {
        await refreshStatus();
      } else {
        alert(result.error);
      }
    });
  };

  const handleCopy = async () => {
    if (specMarkdown) {
      await navigator.clipboard.writeText(specMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
        Triage
      </p>

      {/* Triage to Linear button */}
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        disabled={triaging}
        onClick={handleTriage}
      >
        {triaging
          ? "Creating ticket..."
          : linearIssueId
            ? `Update ${linearIssueId}`
            : "Triage to Linear"}
      </Button>

      {/* Linear link */}
      {linearIssueUrl ? (
        <a
          href={linearIssueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-blue-600 hover:underline"
        >
          {linearIssueId} - Open in Linear
        </a>
      ) : null}

      {/* Generate Spec button */}
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        disabled={generating}
        onClick={handleGenerateSpec}
      >
        {generating ? "Generating spec..." : "Generate Spec"}
      </Button>

      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        disabled={creatingFixPr || cancellingFixPr}
        onClick={handleGenerateFixPr}
      >
        {getFixPrButtonLabel({
          creatingFixPr,
          fixPrStatus,
        })}
      </Button>

      {fixPrStatus ? (
        <FixRunPanel
          fixPrStatus={fixPrStatus}
          isActive={isFixRunActive}
          cancellingFixPr={cancellingFixPr}
          onCancel={handleCancelFixPr}
        />
      ) : null}

      {/* Spec preview */}
      {specMarkdown ? (
        <div className="space-y-2">
          <pre className="max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-[10px] leading-relaxed">
            {specMarkdown}
          </pre>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={handleCopy}
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Triage history */}
      {history.length > 0 ? (
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase text-muted-foreground">
            History
          </p>
          <div className="space-y-1">
            {history.map((h) => (
              <p key={h.id} className="text-[10px] text-muted-foreground">
                {getTriageHistoryLabel(h)}{" "}
                by {h.createdBy} — {timeAgo(h.createdAt)}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const FIX_STAGES = [
  { key: "COLLECTING_CONTEXT", label: "Collecting context" },
  { key: "PLANNING", label: "Planning fix" },
  { key: "FIXING", label: "Applying changes" },
  { key: "REVIEWING", label: "Reviewing changes" },
  { key: "CHECKING", label: "Running checks" },
  { key: "ITERATING", label: "Iterating" },
  { key: "CREATING_PR", label: "Creating PR" },
] as const;

const FIX_STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  QUEUED: { bg: "bg-blue-100", text: "text-blue-700", label: "Queued" },
  RUNNING: { bg: "bg-amber-100", text: "text-amber-700", label: "Running" },
  PASSED: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Passed" },
  WAITING_REVIEW: { bg: "bg-violet-100", text: "text-violet-700", label: "Waiting Review" },
  FAILED: { bg: "bg-red-100", text: "text-red-700", label: "Failed" },
  CANCELLED: { bg: "bg-gray-100", text: "text-gray-600", label: "Cancelled" },
};

function FixRunPanel({
  fixPrStatus,
  isActive,
  cancellingFixPr,
  onCancel,
}: {
  fixPrStatus: FixPRStatusResult;
  isActive: boolean;
  cancellingFixPr: boolean;
  onCancel: () => void;
}) {
  const style = FIX_STATUS_STYLE[fixPrStatus.status] ?? FIX_STATUS_STYLE.RUNNING!;
  const currentStageIndex = FIX_STAGES.findIndex((s) => s.key === fixPrStatus.currentStage);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">
          Fix Run
        </p>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}>
          {isActive && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
            </span>
          )}
          {style.label}
        </span>
      </div>

      {/* Stage progress */}
      {isActive && (
        <div className="space-y-1">
          {FIX_STAGES.map((stage, idx) => {
            const isDone = idx < currentStageIndex;
            const isCurrent = stage.key === fixPrStatus.currentStage;
            return (
              <div key={stage.key} className="flex items-center gap-2">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] ${
                  isDone
                    ? "bg-emerald-500 text-white"
                    : isCurrent
                      ? "bg-amber-500 text-white"
                      : "bg-muted text-muted-foreground"
                }`}>
                  {isDone ? "✓" : isCurrent ? "●" : "○"}
                </span>
                <span className={`text-[10px] ${
                  isCurrent ? "font-medium text-foreground" : isDone ? "text-muted-foreground line-through" : "text-muted-foreground"
                }`}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Iteration counter */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
            <span>Iteration {fixPrStatus.iterationCount}/{fixPrStatus.maxIterations}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className={`h-1.5 rounded-full transition-all ${
                fixPrStatus.status === "PASSED" ? "bg-emerald-500" : fixPrStatus.status === "FAILED" ? "bg-red-500" : "bg-amber-500"
              }`}
              style={{ width: `${Math.max((fixPrStatus.iterationCount / fixPrStatus.maxIterations) * 100, 5)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      {fixPrStatus.summary ? (
        <p className="text-[10px] text-muted-foreground">{fixPrStatus.summary}</p>
      ) : null}

      {/* RCA */}
      {fixPrStatus.rcaSummary ? (
        <div>
          <p className="text-[9px] font-semibold uppercase text-muted-foreground">RCA</p>
          <p className="text-[10px] text-muted-foreground">{fixPrStatus.rcaSummary}</p>
        </div>
      ) : null}

      {/* Error */}
      {fixPrStatus.lastError ? (
        <p className="text-[10px] text-red-600">{fixPrStatus.lastError}</p>
      ) : null}

      {/* PR link */}
      {fixPrStatus.prUrl ? (
        <a
          href={fixPrStatus.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
        >
          {fixPrStatus.prNumber ? `PR #${fixPrStatus.prNumber}` : "Open PR"} →
        </a>
      ) : null}

      {/* Cancel button */}
      {isActive ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-full px-2 text-[10px] text-muted-foreground hover:text-red-600"
          disabled={cancellingFixPr}
          onClick={onCancel}
        >
          {cancellingFixPr ? "Cancelling..." : "Cancel Run"}
        </Button>
      ) : null}

      {/* Auto-refresh indicator */}
      {isActive ? (
        <p className="text-center text-[9px] text-muted-foreground">
          Auto-refreshing every 5s
        </p>
      ) : null}
    </div>
  );
}

async function loadTriageSectionState(threadId: string, workspaceId: string) {
  const [triageResult, fixPrResult] = await Promise.all([
    getTriageStatusAction(threadId, workspaceId),
    getFixPRStatusAction(threadId, workspaceId),
  ]);

  return { triageResult, fixPrResult };
}

function applyTriageSectionState(params: {
  triageResult: Awaited<ReturnType<typeof getTriageStatusAction>>;
  fixPrResult: FixPRStatusResult | null;
  setLinearIssueId: (value: string | null) => void;
  setLinearIssueUrl: (value: string | null) => void;
  setHistory: (value: TriageHistory[]) => void;
  setFixPrStatus: (value: FixPRStatusResult | null) => void;
}) {
  if (params.triageResult) {
    params.setLinearIssueId(params.triageResult.linearIssueId);
    params.setLinearIssueUrl(params.triageResult.linearIssueUrl);
    params.setHistory(params.triageResult.history);
  }

  params.setFixPrStatus(params.fixPrResult);
}

function isActiveFixPrStatus(status: string): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

function getFixPrButtonLabel(params: {
  creatingFixPr: boolean;
  fixPrStatus: FixPRStatusResult | null;
}): string {
  if (params.creatingFixPr) {
    return "Starting fix...";
  }

  if (params.fixPrStatus && isActiveFixPrStatus(params.fixPrStatus.status)) {
    return `Fix Run: ${params.fixPrStatus.currentStage}`;
  }

  if (params.fixPrStatus) {
    return "Retry Fix PR";
  }

  return "Generate Fix PR";
}

function getTriageHistoryLabel(historyItem: TriageHistory): string {
  if (historyItem.action === "CREATE_TICKET") {
    return `Created ${historyItem.linearIssueId}`;
  }

  if (historyItem.action === "UPDATE_TICKET") {
    return `Updated ${historyItem.linearIssueId}`;
  }

  if (historyItem.action === "GENERATE_FIX_PR") {
    return historyItem.prUrl ? "Generated fix PR" : "Recorded fix run";
  }

  return "Generated spec";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
