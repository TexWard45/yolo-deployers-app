import { useState, useCallback } from "react";
import { trpc } from "@/trpc/client";

export type SessionFilters = {
  customerId: string;
  customerEmail: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
};

export type ReplayExplorerReturn = {
  selectedSessionId: string | null;
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  filters: SessionFilters;
  setFilter: (key: keyof SessionFilters, value: string) => void;
  clearFilters: () => void;
  sessions: any[];
  selectedSession: any | undefined;
  sessionsLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  replayData: any | undefined;
  replayLoading: boolean;
  timelineData: any | undefined;
};

const EMPTY_FILTERS: SessionFilters = {
  customerId: "",
  customerEmail: "",
  customerPhone: "",
  startDate: "",
  endDate: "",
};

export function useReplayExplorer(): ReplayExplorerReturn {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [filters, setFilters] = useState<SessionFilters>(EMPTY_FILTERS);

  const filterInput = {
    limit: 20,
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.customerEmail ? { customerEmail: filters.customerEmail } : {}),
    ...(filters.customerPhone ? { customerPhone: filters.customerPhone } : {}),
    ...(filters.startDate ? { startDate: new Date(filters.startDate) } : {}),
    ...(filters.endDate ? { endDate: new Date(filters.endDate) } : {}),
  };

  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    fetchNextPage,
    hasNextPage,
  } = trpc.telemetry.listSessions.useInfiniteQuery(filterInput, {
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const sessions = sessionsData?.pages.flatMap((p) => p.sessions) ?? [];

  const { data: replayData, isLoading: replayLoading } =
    trpc.telemetry.getSessionReplay.useQuery(
      { sessionId: selectedSessionId ?? "" },
      { enabled: !!selectedSessionId }
    );

  const { data: timelineData } = trpc.telemetry.getSessionTimeline.useQuery(
    { sessionId: selectedSessionId ?? "" },
    { enabled: !!selectedSessionId }
  );

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  const setFilter = useCallback((key: keyof SessionFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  return {
    selectedSessionId,
    setSelectedSessionId,
    filters,
    setFilter,
    clearFilters,
    sessions,
    selectedSession,
    sessionsLoading,
    hasMore: hasNextPage ?? false,
    loadMore: () => void fetchNextPage(),
    replayData,
    replayLoading,
    timelineData,
  };
}
