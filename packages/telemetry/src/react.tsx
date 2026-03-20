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
    return () => Telemetry.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>;
}
