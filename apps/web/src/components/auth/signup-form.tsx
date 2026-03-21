"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SignupSchema } from "@shared/types";
import { signup } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthBrandingPanel } from "./auth-branding-panel";
import { ResolveLogoIcon } from "@/components/resolve-logo";

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const parsed = SignupSchema.safeParse({
      username: formData.get("username"),
      password: formData.get("password"),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      setLoading(false);
      return;
    }

    const result = await signup(parsed.data);

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push("/login");
  }

  return (
    <>
      <AuthBrandingPanel
        headline="Start resolving bugs with AI"
        subheadline="Create your free account and let ResolveAI analyze tickets, trace root causes, and ship fixes — automatically."
      />

      {/* Right panel — form */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="gradient-bg flex size-8 items-center justify-center rounded-lg text-white">
                <ResolveLogoIcon className="size-[18px]" />
              </div>
              <span className="text-lg font-bold tracking-tight">ResolveAI</span>
            </Link>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Get started with your free account.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account..." : "Create account"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
