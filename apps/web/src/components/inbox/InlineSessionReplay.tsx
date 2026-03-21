"use client";

import { AlertCircle } from "lucide-react";
import { ReplayViewer } from "@/components/telemetry/ReplayViewer";
import { trpc } from "@/trpc/client";

interface InlineSessionReplayProps {
  sessionId: string;
  replayUrl?: string | null;
}

export function InlineSessionReplay({ sessionId, replayUrl }: InlineSessionReplayProps) {
  const { data: replayData, isLoading: replayLoading } = trpc.telemetry.getSessionReplay.useQuery(
    { sessionId },
    { enabled: !!sessionId },
  );
  const { data: timelineData } = trpc.telemetry.getSessionTimeline.useQuery(
    { sessionId },
    { enabled: !!sessionId },
  );

  const errorTimestamps: number[] = (timelineData ?? [])
    .filter((t) => t.type === "ERROR")
    .map((t) => new Date(t.timestamp).getTime());

  return (
    <div className="mt-3 rounded-lg border bg-background/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Session Recording</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">{sessionId}</span>
          {replayUrl ? (
            <a
              href={replayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-medium text-primary underline underline-offset-2"
            >
              Open Fullscreen
            </a>
          ) : null}
        </div>
      </div>

      {replayLoading ? (
        <div className="h-72 animate-pulse rounded-md border bg-muted/40" />
      ) : replayData?.events && replayData.events.length > 0 ? (
        <div className="overflow-hidden rounded-md border bg-background">
          <ReplayViewer events={replayData.events} errorTimestamps={errorTimestamps} />
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          Replay data is unavailable for this session.
        </div>
      )}
    </div>
  );
}
