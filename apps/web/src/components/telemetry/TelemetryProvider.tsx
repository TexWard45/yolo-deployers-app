"use client";

import { useEffect, useRef } from "react";
import * as rrweb from "rrweb";
import { trpc } from "@/trpc/client";

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;

function generateSessionId(): string {
  return crypto.randomUUID();
}

interface TelemetryEvent {
  type: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  sequence: number;
}

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const sessionIdRef = useRef<string>(generateSessionId());
  const bufferRef = useRef<TelemetryEvent[]>([]);
  const sequenceRef = useRef(0);
  const isFlushing = useRef(false);

  const ingestMutation = trpc.telemetry.ingestEvents.useMutation();
  const mutationRef = useRef(ingestMutation);
  mutationRef.current = ingestMutation;

  useEffect(() => {
    const sessionId = sessionIdRef.current;
    const buffer = bufferRef;
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    async function flush() {
      if (isFlushing.current || buffer.current.length === 0 || stopped) return;
      isFlushing.current = true;

      const batch = buffer.current.splice(0, buffer.current.length);
      try {
        await mutationRef.current.mutateAsync({
          sessionId,
          events: batch,
        });
      } catch {
        buffer.current.unshift(...batch);
      } finally {
        isFlushing.current = false;
      }
    }

    const stopFn = rrweb.record({
      emit(event) {
        buffer.current.push({
          type: "rrweb",
          timestamp: new Date(event.timestamp),
          payload: event as unknown as Record<string, unknown>,
          sequence: sequenceRef.current++,
        });
        if (buffer.current.length >= BATCH_SIZE) {
          void flush();
        }
      },
      maskAllInputs: true,
      blockSelector: "[data-telemetry-block]",
    });

    flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);

    return () => {
      stopped = true;
      stopFn?.();
      if (flushTimer) clearInterval(flushTimer);
      if (buffer.current.length > 0) {
        const finalBatch = buffer.current.splice(0);
        void mutationRef.current.mutateAsync({
          sessionId,
          events: finalBatch,
        }).catch(() => {});
      }
    };
  }, []);

  return <>{children}</>;
}
