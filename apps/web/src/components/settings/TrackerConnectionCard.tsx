"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteTrackerConnection, setDefaultTrackerConnection } from "@/actions/tracker";

interface TrackerConnectionCardProps {
  connection: {
    id: string;
    type: string;
    label: string;
    projectName: string;
    projectKey: string;
    enabled: boolean;
    isDefault: boolean;
  };
  workspaceId: string;
}

export function TrackerConnectionCard({ connection, workspaceId }: TrackerConnectionCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${connection.label}"? Existing issue links on threads will remain.`)) return;
    setDeleting(true);
    try {
      await deleteTrackerConnection(connection.id, workspaceId);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSetDefault() {
    setSettingDefault(true);
    try {
      await setDefaultTrackerConnection(connection.id, workspaceId);
    } finally {
      setSettingDefault(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">{connection.type}</span>
          <span className="text-sm font-medium">{connection.label}</span>
          {connection.isDefault ? (
            <Badge variant="default" className="text-[10px]">Default</Badge>
          ) : null}
          <Badge variant="secondary" className="text-[10px]">
            {connection.enabled ? "Active" : "Disabled"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {connection.projectName} ({connection.projectKey})
        </p>
      </div>
      <div className="flex items-center gap-2">
        {!connection.isDefault ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSetDefault}
            disabled={settingDefault}
          >
            {settingDefault ? "..." : "Set Default"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="destructive"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? "..." : "Delete"}
        </Button>
      </div>
    </div>
  );
}
