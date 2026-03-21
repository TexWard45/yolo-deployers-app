import Link from "next/link";
import { Check } from "lucide-react";

const TIERS = [
  {
    name: "Starter",
    price: "Free",
    period: "",
    description: "For small teams getting started with AI support.",
    features: [
      "100 tickets / month",
      "1 repository indexed",
      "Human Approval mode",
      "Email support",
      "Community access",
    ],
    cta: "Get Started Free",
    href: "/signup",
    featured: false,
  },
  {
    name: "Pro",
    price: "$49",
    period: "/mo",
    description: "For growing teams that want full automation.",
    features: [
      "Unlimited tickets",
      "10 repositories indexed",
      "Auto-Reply mode",
      "Video replay generation",
      "Auto-fix Pull Requests",
      "Priority support",
    ],
    cta: "Start Free Trial",
    href: "/signup",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For organizations with advanced requirements.",
    features: [
      "Everything in Pro",
      "Unlimited repositories",
      "SSO / SAML",
      "Custom integrations",
      "Dedicated account manager",
      "SLA guarantee",
    ],
    cta: "Contact Sales",
    href: "/signup",
    featured: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-7xl px-6 py-24">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Pricing</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Start free. Upgrade when you need more power.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-xl border p-8 shadow-sm transition-shadow hover:shadow-md ${
                tier.featured
                  ? "border-primary/40 ring-1 ring-primary/20"
                  : ""
              }`}
            >
              {tier.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="gradient-bg rounded-full px-3 py-1 text-xs font-semibold text-white shadow-sm">
                    Most Popular
                  </span>
                </div>
              )}

              <div>
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
              </div>

              <div className="mt-6">
                <span className="text-4xl font-extrabold">{tier.price}</span>
                {tier.period && (
                  <span className="text-muted-foreground">{tier.period}</span>
                )}
              </div>

              <ul className="mt-8 flex-1 space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={tier.href}
                className={`mt-8 block rounded-lg py-2.5 text-center text-sm font-semibold transition-opacity ${
                  tier.featured
                    ? "gradient-bg text-white shadow-sm hover:opacity-90"
                    : "border bg-background hover:bg-muted"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
