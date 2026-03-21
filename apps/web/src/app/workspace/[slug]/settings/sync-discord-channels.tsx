"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { syncDiscordChannelsAction } from "@/actions/agent-settings";

interface DiscordConnection {
  id: string;
  name: string;
  status: string;
  configJson: Record<string, unknown> | null;
}

interface SyncDiscordChannelsProps {
  workspaceId: string;
  connections: DiscordConnection[];
}

export function SyncDiscordChannels({ workspaceId, connections }: SyncDiscordChannelsProps) {
  const [nameFilter, setNameFilter] = useState("-support");
  const [syncing, startSync] = useTransition();
  const [syncResult, setSyncResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const handleSync = (connectionId: string) => {
    setSyncResult(null);
    startSync(async () => {
      const result = await syncDiscordChannelsAction({
        workspaceId,
        channelConnectionId: connectionId,
        nameFilter,
      });
      setSyncResult(result);
    });
  };

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold">Discord Channels</Label>
          <p className="text-xs text-muted-foreground">
            Sync Discord channels matching a name filter to start ingesting messages
          </p>
        </div>
      </div>

      <div>
        <Label className="text-sm">Channel Name Filter</Label>
        <p className="mb-1 text-xs text-muted-foreground">
          Only channels containing this text will be synced (e.g. &quot;-support&quot;). Leave empty for all channels.
        </p>
        <input
          type="text"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="-support"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-3">
        {connections.map((conn) => {
          const config = conn.configJson as { channelIds?: string[] } | null;
          const channelCount = config?.channelIds?.length ?? 0;

          return (
            <div key={conn.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{conn.name}</p>
                  <Badge
                    variant="outline"
                    className={
                      conn.status === "active"
                        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                        : "text-muted-foreground"
                    }
                  >
                    {conn.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {channelCount} channel{channelCount !== 1 ? "s" : ""} monitored
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSync(conn.id)}
                disabled={syncing}
              >
                {syncing ? "Syncing..." : "Sync Channels"}
              </Button>
            </div>
          );
        })}
      </div>

      {syncResult?.ok && (
        <p className="text-sm text-emerald-600">
          Sync started! New channels will be discovered and messages backfilled in the background.
        </p>
      )}
      {syncResult && !syncResult.ok && (
        <p className="text-sm text-red-600">{syncResult.error}</p>
      )}
    </div>
  );
}
