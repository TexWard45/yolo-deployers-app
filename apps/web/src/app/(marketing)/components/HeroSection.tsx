import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { BrowserMockup } from "./BrowserMockup";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[800px] w-[1000px] -translate-x-1/2 rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute right-0 top-1/4 h-[400px] w-[400px] rounded-full bg-accent/6 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 pb-20 pt-20 md:pb-28 md:pt-28">
        {/* Badge */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm shadow-sm">
            <span className="inline-flex size-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Now with auto-fix Pull Requests</span>
          </div>
        </div>

        {/* Headline */}
        <h1 className="mx-auto max-w-4xl text-center text-4xl font-extrabold tracking-tight md:text-6xl lg:text-7xl">
          AI that finds bugs, traces code, and{" "}
          <span className="gradient-text">ships fixes</span>
        </h1>

        {/* Subheadline */}
        <p className="mx-auto mt-6 max-w-2xl text-center text-lg text-muted-foreground md:text-xl">
          From bug report to pull request — automatically. ResolveAI analyzes tickets, reproduces issues, traces root causes in your codebase, and delivers fixes before your team wakes up.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/signup"
            className="gradient-bg inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90"
          >
            Start Free Trial
            <ArrowRight className="size-4" />
          </Link>
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-2 rounded-lg border px-6 py-3 text-sm font-semibold transition-colors hover:bg-muted"
          >
            <Play className="size-4" />
            See How It Works
          </a>
        </div>

        {/* Hero screenshot */}
        <div className="mt-16 md:mt-20">
          <BrowserMockup
            src="/images/dashboard-kanban-board-inbox.png"
            alt="ResolveAI Dashboard — Kanban inbox with AI-analyzed tickets"
            priority
            className="mx-auto max-w-5xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
          />
        </div>
      </div>
    </section>
  );
}
