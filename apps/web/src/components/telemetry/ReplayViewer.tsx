"use client";

import { useEffect, useRef } from "react";
import rrwebPlayer from "rrweb-player";
import type { eventWithTime } from "@rrweb/types";
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

    const rrwebEvents = events
      .filter((e) => e.type === "rrweb")
      .map((e) => e.payload) as eventWithTime[];

    if (rrwebEvents.length < 2) return;

    // Wait one animation frame so the container has real layout dimensions
    const raf = requestAnimationFrame(() => {
      if (!containerRef.current) return;

      // Cleanup any previous player
      if (playerRef.current) {
        el.innerHTML = "";
        playerRef.current = null;
      }

      const width = el.clientWidth || 800;
      const height = Math.max(el.clientHeight, 400);

      playerRef.current = new rrwebPlayer({
        target: el,
        props: {
          events: rrwebEvents,
          width,
          height,
          autoPlay: false,
          showController: true,
          speed: 1,
          maxScale: 1,
        },
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      if (el) el.innerHTML = "";
      playerRef.current = null;
    };
  }, [events]);

  const rrwebCount = events.filter((e) => e.type === "rrweb").length;
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

  // min-h ensures the container has height before rrweb-player reads clientHeight
  return <div ref={containerRef} className="w-full min-h-[500px] h-full" />;
}
