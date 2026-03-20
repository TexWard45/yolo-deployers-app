/**
 * @shared/telemetry - Decipher-style session replay SDK
 *
 * Usage (Vanilla JS / any framework):
 *   import { Telemetry } from "@shared/telemetry";
 *   Telemetry.init({ endpoint: "/api/rest" });
 *
 * Usage (React):
 *   import { TelemetryProvider } from "@shared/telemetry/react";
 *   <TelemetryProvider endpoint="/api/rest"> ... </TelemetryProvider>
 */

import * as rrweb from "rrweb";

export interface TelemetryConfig {
  /** The tRPC base URL, e.g. "/api/rest" or "https://your-api.com/api/rest" */
  endpoint: string;
  /** Mask all user inputs for privacy. Default: true */
  maskAllInputs?: boolean;
  /** CSS selector for elements to block from recording. Default: "[data-telemetry-block]" */
  blockSelector?: string;
  /** Max events per batch. Default: 50 */
  batchSize?: number;
  /** Flush interval in ms. Default: 5000 */
  flushIntervalMs?: number;
  /** Sample rate 0-1 for sessions to record. Default: 1.0 */
  sampleRate?: number;
  /** Max size of buffer before throwing away events if offline. Default: 1000 */
  maxBufferSize?: number;
}

interface TelemetryEvent {
  type: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  sequence: number;
}

export class TelemetryClient {
  private _stopFn: (() => void) | null = null;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _sessionId: string | null = null;
  private _buffer: TelemetryEvent[] = [];
  private _sequence = 0;
  private _isFlushing = false;
  private _config: Required<TelemetryConfig> | null = null;
  private _consecutiveErrors = 0;

  private generateSessionId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  private async _flush(): Promise<void> {
    if (this._isFlushing || this._buffer.length === 0 || !this._config || !this._sessionId) return;
    this._isFlushing = true;

    // Throttle if we are constantly erroring out (simple exponential backoff style drop logic would be better but this limits buffer bloat)
    if (this._consecutiveErrors > 5) {
      this._buffer = []; // Drop everything if network is hopelessly dead
      this._consecutiveErrors = 0;
      this._isFlushing = false;
      return;
    }

    const maxBatch = this._config.batchSize * 2; // Don't flush more than double the batch at once to prevent massive payloads
    const batch = this._buffer.splice(0, Math.min(this._buffer.length, maxBatch));
    
    try {
      const res = await fetch(`${this._config.endpoint}/telemetry.ingestEvents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "0": {
            json: {
              sessionId: this._sessionId,
              events: batch.map((e) => ({
                ...e,
                timestamp: e.timestamp.toISOString(),
              })),
            },
          },
        }),
        keepalive: true,
      });

      if (!res.ok) throw new Error("Fetch failed");
      
      this._consecutiveErrors = 0;
    } catch {
      this._consecutiveErrors++;
      // Retry: put events back if buffer is not full
      if (this._buffer.length + batch.length <= this._config.maxBufferSize) {
        this._buffer.unshift(...batch);
      }
    } finally {
      this._isFlushing = false;
    }
  }

  /**
   * Initialize session recording. Call once at app startup.
   */
  public init(config: TelemetryConfig): void {
    if (this._stopFn) {
      console.warn("[Telemetry] Already initialized. Call Telemetry.stop() first.");
      return;
    }

    const sampleRate = config.sampleRate ?? 1.0;
    if (Math.random() > sampleRate) return;

    this._config = {
      endpoint: config.endpoint,
      maskAllInputs: config.maskAllInputs ?? true,
      blockSelector: config.blockSelector ?? "[data-telemetry-block]",
      batchSize: config.batchSize ?? 50,
      flushIntervalMs: config.flushIntervalMs ?? 5000,
      sampleRate,
      maxBufferSize: config.maxBufferSize ?? 1000,
    };

    this._sessionId = this.generateSessionId();
    this._buffer = [];
    this._sequence = 0;
    this._consecutiveErrors = 0;

    const stop = rrweb.record({
      emit: (event) => {
        // Drop events if buffer exceeds max capacity to avoid infinite memory growth
        if (this._config && this._buffer.length >= this._config.maxBufferSize) return;

        this._buffer.push({
          type: "rrweb",
          timestamp: new Date(event.timestamp),
          payload: event as unknown as Record<string, unknown>,
          sequence: this._sequence++,
        });
        
        if (this._config && this._buffer.length >= this._config.batchSize) {
          void this._flush();
        }
      },
      maskAllInputs: this._config.maskAllInputs,
      blockSelector: this._config.blockSelector,
    });

    this._stopFn = stop ?? null;
    this._flushTimer = setInterval(() => void this._flush(), this._config.flushIntervalMs);
  }

  /** Stop recording and flush remaining events */
  public stop(): void {
    this._stopFn?.();
    this._stopFn = null;
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    void this._flush();
  }

  /** Set user identity for the current session */
  public setUser(user: { id?: string; email?: string; username?: string; [key: string]: unknown }): void {
    if (this._sessionId && this._config && this._buffer.length < this._config.maxBufferSize) {
      this._buffer.push({
        type: "user.identify",
        timestamp: new Date(),
        payload: user as Record<string, unknown>,
        sequence: this._sequence++,
      });
    }
  }

  /** Get the current session ID */
  public getSessionId(): string | null {
    return this._sessionId;
  }
}

// Export a default singleton instance for convenience
export const Telemetry = new TelemetryClient();
export default Telemetry;
