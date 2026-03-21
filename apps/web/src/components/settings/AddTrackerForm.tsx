"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTrackerConnection } from "@/actions/tracker";

interface AddTrackerFormProps {
  workspaceId: string;
}

interface ProjectOption {
  id: string;
  name: string;
  key: string;
}

export function AddTrackerForm({ workspaceId }: AddTrackerFormProps) {
  const [open, setOpen] = useState(false);
  const [type] = useState<"LINEAR" | "JIRA">("LINEAR");
  const [apiToken, setApiToken] = useState("");
  const [label, setLabel] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFetchProjects() {
    if (!apiToken.trim()) return;
    setFetching(true);
    setError(null);
    setProjects([]);
    setSelectedProject(null);

    try {
      const res = await fetch(
        `/api/rest/tracker/projects?${new URLSearchParams({ type, apiToken })}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to fetch projects");
        return;
      }
      const data = (await res.json()) as ProjectOption[];
      setProjects(data);
      if (data.length > 0) setSelectedProject(data[0]!);
    } catch {
      setError("Failed to connect");
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    if (!selectedProject || !label.trim()) return;
    setSaving(true);
    setError(null);

    const result = await createTrackerConnection({
      workspaceId,
      type,
      label: label.trim(),
      apiToken,
      projectKey: selectedProject.id,
      projectName: selectedProject.name,
      isDefault,
    });

    if (!result.success) {
      setError(result.error);
      setSaving(false);
      return;
    }

    // Reset and close
    setApiToken("");
    setLabel("");
    setIsDefault(false);
    setProjects([]);
    setSelectedProject(null);
    setOpen(false);
    setSaving(false);
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        + Add Connection
      </Button>
    );
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Add {type} Connection</p>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-xs">API Key</Label>
          <div className="flex gap-2 mt-1">
            <Input
              type="password"
              placeholder={type === "LINEAR" ? "lin_api_..." : "API token"}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              className="text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleFetchProjects}
              disabled={fetching || !apiToken.trim()}
            >
              {fetching ? "Fetching..." : "Fetch Teams"}
            </Button>
          </div>
        </div>

        {projects.length > 0 ? (
          <>
            <div>
              <Label className="text-xs">Team / Project</Label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedProject?.id ?? ""}
                onChange={(e) => {
                  const p = projects.find((p) => p.id === e.target.value);
                  if (p) setSelectedProject(p);
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs">Label</Label>
              <Input
                placeholder="e.g. Support Bugs"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1 text-sm"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Set as default (auto-create issues on IN_PROGRESS)
            </label>

            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !label.trim() || !selectedProject}
            >
              {saving ? "Saving..." : "Save Connection"}
            </Button>
          </>
        ) : null}

        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
