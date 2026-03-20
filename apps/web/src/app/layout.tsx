import type { Metadata } from "next";
import { Providers } from "@/trpc/provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TelemetryProvider } from "@shared/telemetry/react";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import "@/app/globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Template Project",
  description: "Monorepo microservice app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <Providers>
          <TelemetryProvider endpoint="/api/rest">
            <TooltipProvider>{children}</TooltipProvider>
          </TelemetryProvider>
        </Providers>
      </body>
    </html>
  );
}
