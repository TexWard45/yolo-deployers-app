import { Plus_Jakarta_Sans } from "next/font/google";
import { cn } from "@/lib/utils";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-marketing",
});

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-h-screen", jakarta.variable)} style={{ fontFamily: "var(--font-marketing), var(--font-sans), system-ui, sans-serif" }}>
      {children}
    </div>
  );
}
