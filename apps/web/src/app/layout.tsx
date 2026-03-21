import type { Metadata } from "next";
import { Providers } from "@/trpc/provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TelemetryProvider } from "@shared/telemetry/react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import "@/app/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "YOLO Deployers",
  description: "AI-powered support & code intelligence platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={cn("font-sans", inter.variable, jetbrainsMono.variable)}
    >
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
