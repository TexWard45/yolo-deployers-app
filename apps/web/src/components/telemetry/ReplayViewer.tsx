"use client";

import { useEffect, useRef } from "react";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import { AlertCircle } from "lucide-react";

interface ReplayViewerProps {
  events: Array<{ type: string; payload: unknown }>;
}

export function ReplayViewer({ events }: ReplayViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<rrwebPlayer | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Cleanup previous
    if (playerRef.current) {
      el.innerHTML = "";
      playerRef.current = null;
    }

    const rrwebEvents = events
      .filter((e) => e.type === "rrweb")
      .map((e) => e.payload);

    if (rrwebEvents.length < 2) return;

    playerRef.current = new rrwebPlayer({
      target: el,
      props: {
        events: rrwebEvents as any[],
        showController: true,
        autoPlay: false,
        speed: 1,
      },
    });

    return () => {
      if (el) el.innerHTML = "";
      playerRef.current = null;
    };
  }, [events]);

  const rrwebCount = events.filter((e) => e.type === "rrweb").length;
  if (rrwebCount < 2) {
    return (
      <div className="flex-1 w-full flex flex-col items-center justify-center p-12 text-center bg-muted/10">
        <div className="w-16 h-16 rounded-full bg-warning/5 flex items-center justify-center mb-4 transition-transform hover:scale-110">
          <AlertCircle className="w-8 h-8 text-warning/60" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          {rrwebCount === 0 ? "No Recording Data" : "Session Too Brief"}
        </h3>
        <p className="text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
          {rrwebCount === 0 
            ? "We couldn't find any playback events for this session. It might still be processing or was a background ping." 
            : `This session only captured ${rrwebCount} event. Replays require at least 2 events to construct a timeline.`}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[500px] flex flex-col overflow-hidden group">
      <div ref={containerRef} className="flex-1 w-full h-full rrweb-player-container" />
      <style jsx global>{`
        .rrweb-player-container {
          background: #000;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rr-player {
          box-shadow: none !important;
          border: none !important;
        }
        .rr-controller {
          background: rgba(15, 23, 42, 0.9) !important;
          backdrop-filter: blur(8px);
          border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
      `}</style>
    </div>
  );
}
