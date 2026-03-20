import { useState, useMemo } from "react";
import { trpc } from "@/trpc/client";

export type ReplayExplorerReturn = {
  selectedSessionId: string | null;
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  filteredSessions: any[];
  selectedSession: any | undefined;
  sessionsLoading: boolean;
  sessionsData: any | undefined;
  replayData: any | undefined;
  replayLoading: boolean;
  timelineData: any | undefined;
};

export function useReplayExplorer(): ReplayExplorerReturn {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: sessionsData, isLoading: sessionsLoading } =
    trpc.telemetry.listSessions.useQuery({ limit: 50 });

  const { data: replayData, isLoading: replayLoading } =
    trpc.telemetry.getSessionReplay.useQuery(
      { sessionId: selectedSessionId ?? "" },
      { enabled: !!selectedSessionId }
    );

  const { data: timelineData } = trpc.telemetry.getSessionTimeline.useQuery(
    { sessionId: selectedSessionId ?? "" },
    { enabled: !!selectedSessionId }
  );

  const filteredSessions = useMemo(() => {
    if (!sessionsData?.sessions) return [];
    if (!searchQuery) return sessionsData.sessions;
    return sessionsData.sessions.filter((s) => 
      s.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.userAgent?.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [sessionsData, searchQuery]);

  const selectedSession = sessionsData?.sessions.find((s) => s.id === selectedSessionId);

  return {
    selectedSessionId,
    setSelectedSessionId,
    searchQuery,
    setSearchQuery,
    filteredSessions,
    selectedSession,
    sessionsLoading,
    sessionsData,
    replayData,
    replayLoading,
    timelineData,
  };
}
