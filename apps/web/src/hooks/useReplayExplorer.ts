import { useState, useCallback } from "react";
import { trpc } from "@/trpc/client";

export type SessionFilters = {
  customerId: string;
  customerEmail: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
  hasError: boolean;
};

export type ReplayExplorerReturn = {
  selectedSessionId: string | null;
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  filters: SessionFilters;
  setFilter: (key: keyof SessionFilters, value: string) => void;
  setHasErrorFilter: (value: boolean) => void;
  clearFilters: () => void;
  sessions: any[];
  selectedSession: any | undefined;
  sessionsLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  replayData: any | undefined;
  replayLoading: boolean;
  timelineData: any | undefined;
  errorTimestamps: number[];
};

const EMPTY_FILTERS: SessionFilters = {
  customerId: "",
  customerEmail: "",
  customerPhone: "",
  startDate: "",
  endDate: "",
  hasError: false,
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
    ...(filters.hasError ? { hasError: true } : {}),
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

  // Derive absolute error timestamps (ms) from the session timeline for the replay player
  const errorTimestamps: number[] = (timelineData ?? [])
    .filter((t: any) => t.type === "ERROR")
    .map((t: any) => new Date(t.timestamp).getTime());

  const setFilter = useCallback((key: keyof SessionFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setHasErrorFilter = useCallback((value: boolean) => {
    setFilters((prev) => ({ ...prev, hasError: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  return {
    selectedSessionId,
    setSelectedSessionId,
    filters,
    setFilter,
    setHasErrorFilter,
    clearFilters,
    sessions,
    selectedSession,
    sessionsLoading,
    hasMore: hasNextPage ?? false,
    loadMore: () => void fetchNextPage(),
    replayData,
    replayLoading,
    timelineData,
    errorTimestamps,
  };
}
