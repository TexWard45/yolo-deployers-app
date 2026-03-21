"use client";

import { useEffect } from "react";
import { Telemetry } from "./index";
import type { TelemetryConfig } from "./index";

/**
 * React wrapper — drop-in provider for Next.js / React apps.
 *
 * @example
 * import { TelemetryProvider } from "@shared/telemetry/react";
 *
 * <TelemetryProvider endpoint="/api/rest">
 *   {children}
 * </TelemetryProvider>
 */
export function TelemetryProvider({
  children,
  ...config
}: TelemetryConfig & { children: React.ReactNode }) {
  useEffect(() => {
    Telemetry.init(config);

    const onError = (event: ErrorEvent) => {
      Telemetry.logError(event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason ?? "Unhandled Promise Rejection");
      Telemetry.logError(message, { reason: String(event.reason) });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      Telemetry.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>;
}
