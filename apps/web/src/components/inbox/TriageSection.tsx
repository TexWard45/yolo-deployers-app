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
        <div className="space-y-1 rounded border bg-muted/40 p-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            Fix Run
          </p>
          <p className="text-xs">
            {fixPrStatus.status} • {fixPrStatus.currentStage}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Iteration {fixPrStatus.iterationCount}/{fixPrStatus.maxIterations}
          </p>
          {fixPrStatus.summary ? (
            <p className="text-[10px] text-muted-foreground">{fixPrStatus.summary}</p>
          ) : null}
          {fixPrStatus.rcaSummary ? (
            <p className="text-[10px] text-muted-foreground">RCA: {fixPrStatus.rcaSummary}</p>
          ) : null}
          {fixPrStatus.lastError ? (
            <p className="text-[10px] text-red-600">{fixPrStatus.lastError}</p>
          ) : null}
          {fixPrStatus.prUrl ? (
            <a
              href={fixPrStatus.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-blue-600 hover:underline"
            >
              {fixPrStatus.prNumber ? `PR #${fixPrStatus.prNumber}` : "Open PR"}
            </a>
          ) : null}
          {isFixRunActive ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              disabled={cancellingFixPr}
              onClick={handleCancelFixPr}
            >
              {cancellingFixPr ? "Cancelling..." : "Cancel"}
            </Button>
          ) : null}
        </div>
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
