"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { updateAgentConfigAction } from "@/actions/agent-settings";

interface SettingsFormProps {
  workspaceId: string;
  config: {
    enabled: boolean;
    autoReply: boolean;
    analysisEnabled: boolean;
    autoDraftOnInbound: boolean;
    maxClarifications: number;
    tone: string | null;
    systemPrompt: string | null;
    githubToken: string | null;
    githubDefaultOwner: string | null;
    githubDefaultRepo: string | null;
    githubBaseBranch: string | null;
    codexFixModel: string | null;
    codexReviewModel: string | null;
    codexFixMaxIterations: number;
    codexRequiredCheckNames: string[];
  };
}

export function SettingsForm({ workspaceId, config }: SettingsFormProps) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [autoReply, setAutoReply] = useState(config.autoReply);
  const [analysisEnabled, setAnalysisEnabled] = useState(config.analysisEnabled);
  const [autoDraftOnInbound, setAutoDraftOnInbound] = useState(config.autoDraftOnInbound);
  const [maxClarifications, setMaxClarifications] = useState(config.maxClarifications);
  const [tone, setTone] = useState(config.tone ?? "");
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt ?? "");
  const [githubToken, setGitHubToken] = useState(config.githubToken ?? "");
  const [githubDefaultOwner, setGitHubDefaultOwner] = useState(config.githubDefaultOwner ?? "");
  const [githubDefaultRepo, setGitHubDefaultRepo] = useState(config.githubDefaultRepo ?? "");
  const [githubBaseBranch, setGitHubBaseBranch] = useState(config.githubBaseBranch ?? "main");
  const [codexFixModel, setCodexFixModel] = useState(config.codexFixModel ?? "");
  const [codexReviewModel, setCodexReviewModel] = useState(config.codexReviewModel ?? "");
  const [codexFixMaxIterations, setCodexFixMaxIterations] = useState(config.codexFixMaxIterations);
  const [codexRequiredCheckNames, setCodexRequiredCheckNames] = useState(
    config.codexRequiredCheckNames.join(", "),
  );
  const [saving, startSaving] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(false);
    startSaving(async () => {
      const result = await updateAgentConfigAction({
        workspaceId,
        enabled,
        autoReply,
        analysisEnabled,
        autoDraftOnInbound,
        maxClarifications,
        tone: tone || undefined,
        systemPrompt: systemPrompt || undefined,
        githubToken: githubToken || undefined,
        githubDefaultOwner: githubDefaultOwner || undefined,
        githubDefaultRepo: githubDefaultRepo || undefined,
        githubBaseBranch: githubBaseBranch || undefined,
        codexFixModel: codexFixModel || undefined,
        codexReviewModel: codexReviewModel || undefined,
        codexFixMaxIterations,
        codexRequiredCheckNames: codexRequiredCheckNames
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      });
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Master toggle */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-semibold">AI Agent Enabled</Label>
            <p className="text-xs text-muted-foreground">
              Master switch for all AI features in this workspace
            </p>
          </div>
          <Button
            size="sm"
            variant={enabled ? "default" : "outline"}
            onClick={() => setEnabled(!enabled)}
          >
            {enabled ? "On" : "Off"}
          </Button>
        </div>
      </div>

      {/* Reply Mode */}
      <div className="rounded-lg border p-4">
        <Label className="text-sm font-semibold">Reply Mode</Label>
        <p className="mb-3 text-xs text-muted-foreground">
          Choose how the AI handles generated replies
        </p>
        <div className="space-y-2">
          <button
            type="button"
            className={`flex w-full items-start gap-3 rounded-md border p-3 text-left ${
              !autoReply ? "border-primary bg-accent/30" : "border-border"
            }`}
            onClick={() => setAutoReply(false)}
          >
            <div className={`mt-0.5 h-4 w-4 rounded-full border-2 ${!autoReply ? "border-primary bg-primary" : "border-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">Human Approval</p>
              <p className="text-xs text-muted-foreground">
                AI drafts are shown as suggestions. A team member must click Send to deliver them.
              </p>
            </div>
          </button>
          <button
            type="button"
            className={`flex w-full items-start gap-3 rounded-md border p-3 text-left ${
              autoReply ? "border-primary bg-accent/30" : "border-border"
            }`}
            onClick={() => setAutoReply(true)}
          >
            <div className={`mt-0.5 h-4 w-4 rounded-full border-2 ${autoReply ? "border-primary bg-primary" : "border-muted-foreground"}`} />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Auto-Reply</p>
                <Badge variant="outline" className="text-[10px]">Autonomous</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                AI sends replies automatically without waiting for human review. The AI will keep asking clarifying questions until it has enough context, then sends a resolution.
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Analysis settings */}
      <div className="rounded-lg border p-4 space-y-4">
        <div>
          <Label className="text-sm font-semibold">Analysis Pipeline</Label>
          <p className="text-xs text-muted-foreground">
            Configure the AI investigation behavior
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Analysis Enabled</p>
            <p className="text-xs text-muted-foreground">Run analysis on inbound messages</p>
          </div>
          <Button
            size="sm"
            variant={analysisEnabled ? "default" : "outline"}
            onClick={() => setAnalysisEnabled(!analysisEnabled)}
          >
            {analysisEnabled ? "On" : "Off"}
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Auto-Draft on Inbound</p>
            <p className="text-xs text-muted-foreground">Trigger draft generation for every new message</p>
          </div>
          <Button
            size="sm"
            variant={autoDraftOnInbound ? "default" : "outline"}
            onClick={() => setAutoDraftOnInbound(!autoDraftOnInbound)}
          >
            {autoDraftOnInbound ? "On" : "Off"}
          </Button>
        </div>

        <div>
          <Label className="text-sm">Max Clarifications</Label>
          <p className="mb-1 text-xs text-muted-foreground">
            After this many auto-clarifications, escalate to human
          </p>
          <input
            type="number"
            min={0}
            max={10}
            value={maxClarifications}
            onChange={(e) => setMaxClarifications(Number(e.target.value))}
            className="w-20 rounded-md border px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* Tone & Prompt */}
      <div className="rounded-lg border p-4 space-y-4">
        <div>
          <Label className="text-sm font-semibold">Agent Personality</Label>
        </div>

        <div>
          <Label className="text-sm">Tone</Label>
          <p className="mb-1 text-xs text-muted-foreground">e.g. &quot;friendly&quot;, &quot;professional&quot;, &quot;casual&quot;</p>
          <input
            type="text"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="friendly"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <Label className="text-sm">System Prompt</Label>
          <p className="mb-1 text-xs text-muted-foreground">Custom instructions injected into the draft generation prompt</p>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            placeholder="You are a helpful support agent for..."
            className="w-full resize-none rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div>
          <Label className="text-sm font-semibold">GitHub Integration</Label>
          <p className="text-xs text-muted-foreground">
            Optional for draft PR creation. Leave blank to run the local fix loop without GitHub.
          </p>
        </div>

        <div>
          <Label className="text-sm">GitHub Token</Label>
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGitHubToken(e.target.value)}
            placeholder="ghp_..."
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-sm">Owner</Label>
            <input
              type="text"
              value={githubDefaultOwner}
              onChange={(e) => setGitHubDefaultOwner(e.target.value)}
              placeholder="TexWard45"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label className="text-sm">Repo</Label>
            <input
              type="text"
              value={githubDefaultRepo}
              onChange={(e) => setGitHubDefaultRepo(e.target.value)}
              placeholder="yolo-deployers-app"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <Label className="text-sm">Base Branch</Label>
          <input
            type="text"
            value={githubBaseBranch}
            onChange={(e) => setGitHubBaseBranch(e.target.value)}
            placeholder="main"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div>
          <Label className="text-sm font-semibold">Codex Fix Loop</Label>
          <p className="text-xs text-muted-foreground">
            Configure the fixer/reviewer models and validation thresholds.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-sm">Fix Model</Label>
            <input
              type="text"
              value={codexFixModel}
              onChange={(e) => setCodexFixModel(e.target.value)}
              placeholder="gpt-5.4-codex"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label className="text-sm">Review Model</Label>
            <input
              type="text"
              value={codexReviewModel}
              onChange={(e) => setCodexReviewModel(e.target.value)}
              placeholder="gpt-5.4-codex"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <Label className="text-sm">Max Iterations</Label>
          <input
            type="number"
            min={1}
            max={10}
            value={codexFixMaxIterations}
            onChange={(e) => setCodexFixMaxIterations(Number(e.target.value))}
            className="w-20 rounded-md border px-2 py-1 text-sm"
          />
        </div>

        <div>
          <Label className="text-sm">Required Checks</Label>
          <p className="mb-1 text-xs text-muted-foreground">
            Comma-separated check names that must pass before the run can finish.
          </p>
          <input
            type="text"
            value={codexRequiredCheckNames}
            onChange={(e) => setCodexRequiredCheckNames(e.target.value)}
            placeholder="build-web, build-queue"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        {saved ? (
          <span className="text-sm text-emerald-600">Settings saved</span>
        ) : null}
      </div>
    </div>
  );
}
