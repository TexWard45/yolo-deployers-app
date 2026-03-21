"use client";

import { useEffect, useRef } from "react";
import rrwebPlayer from "rrweb-player";
import type { eventWithTime } from "@rrweb/types";
import "rrweb-player/dist/style.css";
import { AlertCircle } from "lucide-react";

// rrweb-player renders: [replay frame] + [controller bar (~80px)]
const CONTROLLER_HEIGHT = 80;

interface ReplayViewerProps {
  events: Array<{ type: string | number; payload: unknown }>;
  /** Absolute Unix timestamps (ms) of error events — used for timeline markers and auto-seek */
  errorTimestamps?: number[];
  /**
   * Backend-computed offset (ms from first rrweb event) to seek to on load.
   * When provided, takes priority over the errorTimestamps-derived seek position.
   * Comes from telemetry.getExactErrorMoment — already anchored to the first ReplayEvent.
   */
  initialOffsetMs?: number;
}

export function ReplayViewer({ events, errorTimestamps, initialOffsetMs }: ReplayViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<rrwebPlayer | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const rrwebEvents = events
      .filter((e) => e.type === "rrweb" || e.type === 2)
      .map((e) => (typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload)) as eventWithTime[];

    if (rrwebEvents.length < 2) return;

    // Wait one animation frame so clientWidth/Height are resolved
    const raf = requestAnimationFrame(() => {
      if (!containerRef.current) return;

      // Clean up any previous player instance
      if (playerRef.current) {
        el.innerHTML = "";
        playerRef.current = null;
      }

      const width = el.clientWidth || 800;
      const height = Math.max(el.clientHeight - CONTROLLER_HEIGHT, 300);

      playerRef.current = new rrwebPlayer({
        target: el,
        props: {
          events: rrwebEvents,
          width,
          height,
          showController: true,
          autoPlay: false,
          speed: 1,
          ...(errorTimestamps && errorTimestamps.length > 0
            ? { tags: { "Error": errorTimestamps } }
            : {}),
        },
      });

      // Seek priority:
      //   1. initialOffsetMs — backend-computed precise offset (from getExactErrorMoment)
      //   2. errorTimestamps — derived from SessionTimeline, computed client-side
      if (initialOffsetMs !== undefined) {
        const seekTime = Math.max(0, initialOffsetMs - 3000);
        setTimeout(() => playerRef.current?.goto(seekTime, true), 500);
      } else if (errorTimestamps && errorTimestamps.length > 0 && rrwebEvents[0]) {
        const offset = Math.max(0, errorTimestamps[0]! - rrwebEvents[0].timestamp - 3000);
        setTimeout(() => playerRef.current?.goto(offset, true), 500);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      if (playerRef.current) {
        try { (playerRef.current as unknown as { $destroy(): void }).$destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
      if (el) el.innerHTML = "";
    };
  }, [events, errorTimestamps, initialOffsetMs]);

  const rrwebCount = events.filter((e) => e.type === "rrweb" || e.type === 2).length;
  if (rrwebCount < 2) {
    return (
      <div className="flex-1 w-full flex flex-col items-center justify-center p-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">
          {rrwebCount === 0 ? "No Recording Data" : "Session Too Brief"}
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          {rrwebCount === 0
            ? "No playback events found for this session."
            : `Only ${rrwebCount} event captured — need at least 2 to replay.`}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full min-h-[500px] h-full"
    />
  );
}
