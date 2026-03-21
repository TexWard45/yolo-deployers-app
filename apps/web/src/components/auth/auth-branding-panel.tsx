import Link from "next/link";
import { ResolveLogoIcon } from "@/components/resolve-logo";

interface AuthBrandingPanelProps {
  headline: string;
  subheadline: string;
}

export function AuthBrandingPanel({ headline, subheadline }: AuthBrandingPanelProps) {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden gradient-bg p-10 text-white lg:flex">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-1/4 size-80 rounded-full bg-white/5 blur-[80px]" />
        <div className="absolute -right-10 bottom-1/4 size-60 rounded-full bg-white/5 blur-[60px]" />
      </div>

      {/* Logo */}
      <div className="relative">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-white/20">
            <ResolveLogoIcon className="size-[18px]" />
          </div>
          <span className="text-lg font-bold tracking-tight">ResolveAI</span>
        </Link>
      </div>

      {/* Content */}
      <div className="relative space-y-4">
        <h2 className="text-3xl font-extrabold tracking-tight">{headline}</h2>
        <p className="max-w-sm text-base text-white/70 leading-relaxed">{subheadline}</p>
      </div>

      {/* Testimonial */}
      <div className="relative">
        <blockquote className="border-l-2 border-white/30 pl-4">
          <p className="text-sm text-white/70 italic leading-relaxed">
            &ldquo;ResolveAI cut our average bug resolution time from 4 hours to 12 minutes. The auto-fix PRs are surprisingly accurate.&rdquo;
          </p>
          <footer className="mt-2 text-sm font-medium text-white/50">
            — Engineering Lead, Series B Startup
          </footer>
        </blockquote>
      </div>
    </div>
  );
}
