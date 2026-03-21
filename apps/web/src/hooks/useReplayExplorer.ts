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
  page: number;
  totalPages: number;
  total: number;
  goToPage: (p: number) => void;
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
  const [page, setPage] = useState(1);

  const filterInput = {
    page,
    limit: 20,
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.customerEmail ? { customerEmail: filters.customerEmail } : {}),
    ...(filters.customerPhone ? { customerPhone: filters.customerPhone } : {}),
    ...(filters.startDate ? { startDate: new Date(filters.startDate) } : {}),
    ...(filters.endDate ? { endDate: new Date(filters.endDate) } : {}),
    ...(filters.hasError ? { hasError: true } : {}),
  };

  const { data: sessionsData, isLoading: sessionsLoading } =
    trpc.telemetry.listSessions.useQuery(filterInput);

  const sessions = sessionsData?.sessions ?? [];
  const total = sessionsData?.total ?? 0;
  const totalPages = sessionsData?.totalPages ?? 0;

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
    setPage(1); // reset to page 1 on filter change
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setHasErrorFilter = useCallback((value: boolean) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, hasError: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  }, []);

  const goToPage = useCallback((p: number) => {
    setPage(p);
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
    page,
    totalPages,
    total,
    goToPage,
    replayData,
    replayLoading,
    timelineData,
    errorTimestamps,
  };
}
