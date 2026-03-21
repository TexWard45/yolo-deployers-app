"use client";

import { useEffect, useRef } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/style.css";
import { AlertCircle } from "lucide-react";

interface ReplayViewerProps {
  events: Array<{ type: string; payload: unknown }>;
}

export function ReplayViewer({ events }: ReplayViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Cleanup previous instance
    if (replayerRef.current) {
      try { replayerRef.current.pause(); } catch { /* ignore */ }
      el.innerHTML = "";
      replayerRef.current = null;
    }

    const rrwebEvents = events
      .filter((e) => e.type === "rrweb")
      .map((e) => e.payload);

    if (rrwebEvents.length < 2) return;

    replayerRef.current = new Replayer(rrwebEvents as Parameters<typeof Replayer>[0], {
      root: el,
      speed: 1,
      showController: true,
      useVirtualDom: false,
    });

    replayerRef.current.play();

    return () => {
      try { replayerRef.current?.pause(); } catch { /* ignore */ }
      replayerRef.current = null;
      if (el) el.innerHTML = "";
    };
  }, [events]);

  const rrwebCount = events.filter((e) => e.type === "rrweb").length;
  if (rrwebCount < 2) {
    return (
      <div className="flex-1 w-full flex flex-col items-center justify-center p-12 text-center bg-muted/10">
        <div className="w-16 h-16 rounded-full bg-warning/5 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-warning/60" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          {rrwebCount === 0 ? "No Recording Data" : "Session Too Brief"}
        </h3>
        <p className="text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
          {rrwebCount === 0
            ? "No playback events found for this session."
            : `This session only captured ${rrwebCount} event. Replays require at least 2 events.`}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[500px] bg-slate-900 overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
