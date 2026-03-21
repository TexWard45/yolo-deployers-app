"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { updateAgentConfigAction, testSentryConnectionAction } from "@/actions/agent-settings";

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
    sentryOrgSlug: string | null;
    sentryProjectSlug: string | null;
    hasSentryToken: boolean;
    linearTeamId: string | null;
    hasLinearKey: boolean;
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
  const [codexFixMaxIterations, setCodexFixMaxIterations] = useState(config.codexFixMaxIterations ?? 3);
  const [codexRequiredCheckNames, setCodexRequiredCheckNames] = useState(
    (config.codexRequiredCheckNames ?? []).join(", "),
  );

  // Sentry
  const [sentryOrgSlug, setSentryOrgSlug] = useState(config.sentryOrgSlug ?? "");
  const [sentryProjectSlug, setSentryProjectSlug] = useState(config.sentryProjectSlug ?? "");
  const [sentryAuthToken, setSentryAuthToken] = useState("");
  const [sentryConnected, setSentryConnected] = useState(config.hasSentryToken);
  const [sentryTesting, startSentryTest] = useTransition();
  const [sentryTestResult, setSentryTestResult] = useState<{ ok: boolean; projectName?: string; error?: string } | null>(null);

  // Linear
  const [linearApiKey, setLinearApiKey] = useState("");
  const [linearTeamId, setLinearTeamId] = useState(config.linearTeamId ?? "");
  const [linearConnected] = useState(config.hasLinearKey);
  const [saving, startSaving] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleTestSentry = () => {
    if (!sentryOrgSlug || !sentryProjectSlug || (!sentryAuthToken && !sentryConnected)) return;

    setSentryTestResult(null);
    startSentryTest(async () => {
      const result = await testSentryConnectionAction({
        workspaceId,
        sentryOrgSlug,
        sentryProjectSlug,
        sentryAuthToken: sentryAuthToken || "existing",
      });
      setSentryTestResult(result);
    });
  };

  const handleSave = () => {
    setSaved(false);
    startSaving(async () => {
      const updates: Parameters<typeof updateAgentConfigAction>[0] = {
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
        sentryOrgSlug: sentryOrgSlug || undefined,
        sentryProjectSlug: sentryProjectSlug || undefined,
      };

      // Only send tokens if user entered new ones
      if (sentryAuthToken) updates.sentryAuthToken = sentryAuthToken;
      if (linearApiKey) updates.linearApiKey = linearApiKey;
      if (linearTeamId) updates.linearTeamId = linearTeamId;

      const result = await updateAgentConfigAction(updates);
      if (result.success) {
        setSaved(true);
        if (sentryAuthToken) setSentryConnected(true);
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

      {/* Sentry Integration */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-semibold">Sentry Integration</Label>
            <p className="text-xs text-muted-foreground">
              Connect your Sentry project so the AI can reference runtime errors when investigating issues
            </p>
          </div>
          {sentryConnected ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Connected</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Not configured</Badge>
          )}
        </div>

        <div>
          <Label className="text-sm">Organization Slug</Label>
          <p className="mb-1 text-xs text-muted-foreground">
            Found in your Sentry URL: sentry.io/organizations/<strong>your-org</strong>/
          </p>
          <input
            type="text"
            value={sentryOrgSlug}
            onChange={(e) => setSentryOrgSlug(e.target.value)}
            placeholder="my-org"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <Label className="text-sm">Project Slug</Label>
          <p className="mb-1 text-xs text-muted-foreground">
            Found in Settings &gt; Projects &gt; your project name
          </p>
          <input
            type="text"
            value={sentryProjectSlug}
            onChange={(e) => setSentryProjectSlug(e.target.value)}
            placeholder="my-nextjs-app"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <Label className="text-sm">Auth Token</Label>
          <p className="mb-1 text-xs text-muted-foreground">
            Create at Settings &gt; Auth Tokens. Needs project:read, event:read scopes.
            {sentryConnected ? " Leave blank to keep existing token." : ""}
          </p>
          <input
            type="password"
            value={sentryAuthToken}
            onChange={(e) => setSentryAuthToken(e.target.value)}
            placeholder={sentryConnected ? "********** (saved)" : "sntrys_xxx..."}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestSentry}
            disabled={sentryTesting || !sentryOrgSlug || !sentryProjectSlug || (!sentryAuthToken && !sentryConnected)}
          >
            {sentryTesting ? "Testing..." : "Test Connection"}
          </Button>
          {sentryTestResult?.ok ? (
            <span className="text-sm text-emerald-600">
              Connected to &quot;{sentryTestResult.projectName}&quot;
            </span>
          ) : sentryTestResult ? (
            <span className="text-sm text-red-600">{sentryTestResult.error}</span>
          ) : null}
        </div>
      </div>

      {/* Linear Integration */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-semibold">Linear Integration</Label>
            <p className="text-xs text-muted-foreground">
              Connect Linear so the AI can automatically triage issues into your project board
            </p>
          </div>
          {linearConnected ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Connected</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Not configured</Badge>
          )}
        </div>

        <div>
          <Label className="text-sm">Team ID</Label>
          <p className="mb-1 text-xs text-muted-foreground">
            The Linear team ID where issues will be created
          </p>
          <input
            type="text"
            value={linearTeamId}
            onChange={(e) => setLinearTeamId(e.target.value)}
            placeholder="TEAM-123"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <Label className="text-sm">API Key</Label>
          <p className="mb-1 text-xs text-muted-foreground">
            Create at linear.app &gt; Settings &gt; API. {linearConnected ? "Leave blank to keep existing key." : ""}
          </p>
          <input
            type="password"
            value={linearApiKey}
            onChange={(e) => setLinearApiKey(e.target.value)}
            placeholder={linearConnected ? "********** (saved)" : "lin_api_xxx..."}
            className="w-full rounded-md border px-3 py-2 text-sm"
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
