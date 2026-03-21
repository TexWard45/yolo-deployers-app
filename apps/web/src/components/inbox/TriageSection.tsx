"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  triageToLinearAction,
  getTriageStatusAction,
  generateSpecAction,
} from "@/actions/inbox";

interface TriageHistory {
  id: string;
  action: string;
  linearIssueId: string | null;
  linearIssueUrl: string | null;
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
  const [triaging, startTriaging] = useTransition();
  const [generating, startGenerating] = useTransition();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTriageStatusAction(threadId, workspaceId).then((result) => {
      if (cancelled || !result) return;
      setLinearIssueId(result.linearIssueId);
      setLinearIssueUrl(result.linearIssueUrl);
      setHistory(result.history);
    });
    return () => { cancelled = true; };
  }, [threadId, workspaceId]);

  const refreshStatus = async () => {
    const result = await getTriageStatusAction(threadId, workspaceId);
    if (result) {
      setLinearIssueId(result.linearIssueId);
      setLinearIssueUrl(result.linearIssueUrl);
      setHistory(result.history);
    }
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
                {h.action === "CREATE_TICKET"
                  ? `Created ${h.linearIssueId}`
                  : h.action === "UPDATE_TICKET"
                    ? `Updated ${h.linearIssueId}`
                    : "Generated spec"}{" "}
                by {h.createdBy} — {timeAgo(h.createdAt)}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
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
