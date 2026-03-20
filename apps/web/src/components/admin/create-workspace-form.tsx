"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createWorkspace } from "@/actions/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreateWorkspaceForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = (formData.get("name") as string).trim();

    if (!name) {
      setError("Workspace name is required");
      setLoading(false);
      return;
    }

    const slug = slugify(name);
    if (slug.length < 3) {
      setError("Name must produce a slug of at least 3 characters");
      setLoading(false);
      return;
    }

    const result = await createWorkspace({ name, slug, userId });

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    form.reset();
    setLoading(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Workspace</CardTitle>
        <CardDescription>Add a new workspace</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" name="name" placeholder="My Workspace" required />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Workspace"}
          </Button>
        </CardContent>
      </form>
    </Card>
  );
}
