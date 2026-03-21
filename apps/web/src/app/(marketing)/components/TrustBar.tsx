export function TrustBar() {
  const stats = [
    { value: "10,000+", label: "Bugs auto-resolved" },
    { value: "50%", label: "Faster resolution time" },
    { value: "500+", label: "Teams using ResolveAI" },
    { value: "99.9%", label: "Uptime SLA" },
  ];

  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-extrabold tabular-nums gradient-text">{stat.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Placeholder logos */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-40">
          {["Acme Corp", "Globex", "Initech", "Hooli", "Pied Piper", "Massive Dynamic"].map((name) => (
            <span key={name} className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
