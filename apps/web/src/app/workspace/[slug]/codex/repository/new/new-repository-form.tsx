"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createCodexRepository } from "@/actions/codex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateCodexRepositorySchema } from "@shared/types";
import { ArrowLeft } from "lucide-react";

const SOURCE_TYPES = [
  { value: "GITHUB", label: "GitHub" },
  { value: "GITLAB", label: "GitLab" },
  { value: "BITBUCKET", label: "Bitbucket" },
  { value: "AZURE_DEVOPS", label: "Azure DevOps" },
  { value: "LOCAL_GIT", label: "Local Git" },
  { value: "ARCHIVE", label: "Archive" },
] as const;

const SYNC_MODES = [
  { value: "MANUAL", label: "Manual" },
  { value: "WEBHOOK", label: "Webhook" },
  { value: "CRON", label: "Scheduled (Cron)" },
] as const;

interface NewRepositoryFormProps {
  workspaceId: string;
  workspaceSlug: string;
}

export function NewRepositoryForm({ workspaceId, workspaceSlug }: NewRepositoryFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceType, setSourceType] = useState("GITHUB");
  const [syncMode, setSyncMode] = useState("MANUAL");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    const raw = {
      workspaceId,
      sourceType,
      sourceUrl: (formData.get("sourceUrl") as string).trim(),
      defaultBranch: (formData.get("defaultBranch") as string).trim() || "main",
      syncMode,
      cronExpression: syncMode === "CRON" ? (formData.get("cronExpression") as string).trim() : undefined,
      displayName: (formData.get("displayName") as string).trim(),
      description: (formData.get("description") as string).trim() || undefined,
      extensionAllowlist: parseCommaList(formData.get("extensionAllowlist") as string),
      pathDenylist: parseCommaList(formData.get("pathDenylist") as string),
    };

    const parsed = CreateCodexRepositorySchema.safeParse(raw);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      setLoading(false);
      return;
    }

    const result = await createCodexRepository(parsed.data);

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/workspace/${workspaceSlug}/codex`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" render={<Link href={`/workspace/${workspaceSlug}/codex`} />}>
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Add Repository</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Repository Details</CardTitle>
          <CardDescription>
            Connect a source code repository for indexing and search
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                name="displayName"
                placeholder="my-awesome-repo"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Optional description..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sourceType">Source Type</Label>
              <select
                id="sourceType"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {SOURCE_TYPES.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sourceUrl">
                {sourceType === "LOCAL_GIT" ? "Local Path" : "Clone URL"}
              </Label>
              <Input
                id="sourceUrl"
                name="sourceUrl"
                placeholder={
                  sourceType === "LOCAL_GIT"
                    ? "/path/to/repo"
                    : "https://github.com/owner/repo.git"
                }
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="defaultBranch">Default Branch</Label>
              <Input
                id="defaultBranch"
                name="defaultBranch"
                placeholder="main"
                defaultValue="main"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="syncMode">Sync Mode</Label>
              <select
                id="syncMode"
                value={syncMode}
                onChange={(e) => setSyncMode(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {SYNC_MODES.map((sm) => (
                  <option key={sm.value} value={sm.value}>
                    {sm.label}
                  </option>
                ))}
              </select>
            </div>

            {syncMode === "CRON" && (
              <div className="space-y-2">
                <Label htmlFor="cronExpression">Cron Expression</Label>
                <Input
                  id="cronExpression"
                  name="cronExpression"
                  placeholder="0 */6 * * *"
                />
                <p className="text-xs text-muted-foreground">
                  How often to automatically sync (e.g., every 6 hours)
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="extensionAllowlist">
                Extension Allowlist
              </Label>
              <Input
                id="extensionAllowlist"
                name="extensionAllowlist"
                placeholder=".ts, .tsx, .js, .py"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. Leave empty to index all file types.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pathDenylist">Path Denylist</Label>
              <Input
                id="pathDenylist"
                name="pathDenylist"
                placeholder="node_modules, dist, .git"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated directories to exclude
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Add Repository"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}

function parseCommaList(value: string): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
