import { MessageSquare, Brain, Video, Search, GitPullRequest, Bell } from "lucide-react";

const STEPS = [
  {
    icon: MessageSquare,
    title: "Customer Reports",
    description: "A bug ticket arrives in your inbox via Discord, in-app chat, or email.",
  },
  {
    icon: Brain,
    title: "AI Analyzes",
    description: "Severity, tags, affected component, and root cause identified automatically.",
  },
  {
    icon: Video,
    title: "Video Generated",
    description: "Step-by-step bug reproduction video created from session replay data.",
  },
  {
    icon: Search,
    title: "Code Traced",
    description: "AI pinpoints the exact source file and function causing the issue.",
  },
  {
    icon: GitPullRequest,
    title: "Fix & PR Created",
    description: "AI writes the fix, runs tests, and opens a Pull Request for review.",
  },
  {
    icon: Bell,
    title: "Customer Notified",
    description: "AI drafts a resolution reply and sends it — with or without human approval.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-t bg-muted/20">
      <div className="mx-auto max-w-7xl px-6 py-24">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">How It Works</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            From bug report to merged fix in minutes
          </h2>
        </div>

        {/* Steps grid */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="group relative rounded-xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Step number */}
                <div className="absolute -top-3 left-5 inline-flex size-7 items-center justify-center rounded-full gradient-bg text-xs font-bold text-white shadow-sm">
                  {i + 1}
                </div>

                <div className="mt-2">
                  <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
