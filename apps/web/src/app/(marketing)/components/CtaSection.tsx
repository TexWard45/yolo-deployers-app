import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CtaSection() {
  return (
    <section className="border-t">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="relative overflow-hidden rounded-2xl gradient-bg px-8 py-16 text-center text-white shadow-lg md:px-16">
          {/* Background decoration */}
          <div className="pointer-events-none absolute inset-0 opacity-20">
            <div className="absolute -left-20 -top-20 size-80 rounded-full bg-white/10 blur-[80px]" />
            <div className="absolute -bottom-20 -right-20 size-60 rounded-full bg-white/10 blur-[60px]" />
          </div>

          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">
              Stop debugging. Start resolving.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/80">
              Join 500+ engineering teams that let AI handle bug triage, root cause analysis, and code fixes — automatically.
            </p>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-foreground shadow-sm transition-opacity hover:opacity-90"
              >
                Get Started Free
                <ArrowRight className="size-4" />
              </Link>
            </div>
            <p className="mt-4 text-sm text-white/60">
              No credit card required. Free for small teams.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
