import { redirect } from "next/navigation";
import { getSession } from "@/actions/auth";
import { createCaller, createTRPCContext } from "@shared/rest";
import { SettingsForm } from "./settings-form";
import { SyncDiscordChannels } from "./sync-discord-channels";

interface SettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const workspace = session.workspaces.find((w) => w.slug === slug);
  if (!workspace) redirect("/");

  const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
  const [config, connections] = await Promise.all([
    trpc.agent.getWorkspaceConfig({
      workspaceId: workspace.id,
      userId: session.id,
    }),
    trpc.channelConnection.listByWorkspace({
      workspaceId: workspace.id,
      userId: session.id,
    }),
  ]);

  const discordConnections = connections.filter((c) => c.type === "DISCORD");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="gradient-text text-2xl font-bold tracking-tight">AI Agent Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure how the AI agent handles customer support for this workspace.
        </p>
      </div>

      {discordConnections.length > 0 && (
        <SyncDiscordChannels
          workspaceId={workspace.id}
          connections={discordConnections.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            configJson: c.configJson as Record<string, unknown> | null,
          }))}
        />
      )}

      <SettingsForm
        workspaceId={workspace.id}
        config={{
          enabled: config.enabled,
          autoReply: config.autoReply,
          analysisEnabled: config.analysisEnabled,
          autoDraftOnInbound: config.autoDraftOnInbound,
          maxClarifications: config.maxClarifications,
          tone: config.tone,
          systemPrompt: config.systemPrompt,
          githubToken: (config as Record<string, unknown>).githubToken as string | null ?? null,
          githubDefaultOwner: (config as Record<string, unknown>).githubDefaultOwner as string | null ?? null,
          githubDefaultRepo: (config as Record<string, unknown>).githubDefaultRepo as string | null ?? null,
          githubBaseBranch: (config as Record<string, unknown>).githubBaseBranch as string | null ?? null,
          codexFixModel: (config as Record<string, unknown>).codexFixModel as string | null ?? null,
          codexReviewModel: (config as Record<string, unknown>).codexReviewModel as string | null ?? null,
          codexFixMaxIterations: (config as Record<string, unknown>).codexFixMaxIterations as number ?? 3,
          codexRequiredCheckNames: (config as Record<string, unknown>).codexRequiredCheckNames as string[] ?? [],
          sentryOrgSlug: config.sentryOrgSlug,
          sentryProjectSlug: config.sentryProjectSlug,
          hasSentryToken: config.sentryAuthToken === "***",
          linearTeamId: config.linearTeamId,
          hasLinearKey: config.linearApiKey === "***",
          hasLinearTeamId: Boolean(config.linearTeamId),
        }}
      />
    </div>
  );
}
