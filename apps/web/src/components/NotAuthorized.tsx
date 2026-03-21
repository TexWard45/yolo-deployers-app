"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { logout } from "@/actions/auth";

export function NotAuthorized() {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <div className="rounded-full bg-red-100 p-4">
        <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold">Not Authorized</h1>
      <p className="text-sm text-muted-foreground">
        You are not a member of this workspace.
      </p>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(() => logout())}
      >
        {pending ? "Logging out..." : "Log Out"}
      </Button>
    </div>
  );
}
