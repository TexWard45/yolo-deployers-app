import { BrowserMockup } from "./BrowserMockup";
import { Sparkles, Code2, GitPullRequest, ShieldCheck } from "lucide-react";

const FEATURES = [
  {
    icon: Sparkles,
    title: "AI Bug Analysis & Video Replay",
    description:
      "Every incoming ticket is instantly analyzed — severity, tags, and affected component identified automatically. AI generates a step-by-step video showing exactly how the bug occurs, so your team never asks \"can you reproduce it?\" again.",
    image: "/images/thread-detail-ai-draft-reply.png",
    imageAlt: "Thread detail with AI analysis panel and drafted resolution reply",
  },
  {
    icon: Code2,
    title: "Source Code Tracing",
    description:
      "Codex indexes your entire codebase — every function, class, and module. When a bug is reported, AI traces it to the exact file and line causing the issue. No more hours of manual debugging.",
    image: "/images/codex-repository-indexing.png",
    imageAlt: "Codex repository indexing with stats on files, chunks, and embeddings",
  },
  {
    icon: GitPullRequest,
    title: "Auto-Fix & Pull Request",
    description:
      "AI doesn't just find the bug — it writes the fix. A pull request is generated with the proposed solution, linked to the original ticket. Your team reviews and merges, or it ships automatically.",
    image: "/images/codex-repository-detail-sync.png",
    imageAlt: "Repository detail showing GitHub sync configuration and sync history",
  },
  {
    icon: ShieldCheck,
    title: "Human-in-the-Loop or Full Autopilot",
    description:
      "Choose your comfort level. Human Approval mode lets your team review every AI draft before it reaches customers. Auto-Reply mode handles everything end-to-end — from analysis to customer notification.",
    image: "/images/ai-agent-settings-config.png",
    imageAlt: "AI Agent settings with Human Approval vs Auto-Reply configuration",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20">
      <div className="mx-auto max-w-7xl px-6 py-24">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Features</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            Everything you need to resolve bugs at machine speed
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            An end-to-end pipeline that turns customer complaints into shipped fixes — without human bottlenecks.
          </p>
        </div>

        {/* Feature blocks */}
        <div className="mt-20 space-y-24">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            const isReversed = i % 2 === 1;

            return (
              <div
                key={feature.title}
                className={`flex flex-col items-center gap-12 lg:flex-row lg:gap-16 ${
                  isReversed ? "lg:flex-row-reverse" : ""
                }`}
              >
                {/* Text */}
                <div className="flex-1 space-y-4">
                  <div className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold tracking-tight">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>

                {/* Image */}
                <div className="flex-1">
                  <BrowserMockup
                    src={feature.image}
                    alt={feature.imageAlt}
                    className="shadow-xl"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
