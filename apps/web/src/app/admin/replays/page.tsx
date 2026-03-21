"use client";

import { ReplayViewer } from "@/components/telemetry/ReplayViewer";
import { useReplayExplorer } from "@/hooks/useReplayExplorer";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Play, History, List, AlertCircle, Clock, MousePointer2, X, ChevronDown, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ReplaysPage() {
  const {
    selectedSessionId,
    setSelectedSessionId,
    filters,
    setFilter,
    setHasErrorFilter,
    clearFilters,
    sessions,
    selectedSession,
    sessionsLoading,
    hasMore,
    loadMore,
    replayData,
    replayLoading,
    timelineData,
    errorTimestamps,
  } = useReplayExplorer();

  const hasActiveFilters = Object.values(filters).some(Boolean) || filters.hasError;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-background">
      <header className="flex items-center justify-between px-6 py-4 border-b bg-card">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Session Replays</h1>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="px-3 py-1 bg-primary/5 border-primary/20">
            {sessions.length} Sessions{hasMore ? "+" : ""}
          </Badge>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Pane: Session List */}
        <aside className="w-80 border-r bg-card/50 flex flex-col">
          {/* Filters */}
          <div className="p-3 space-y-2 border-b">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Filters</span>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
            <Input
              placeholder="Customer ID"
              className="h-7 text-[11px]"
              value={filters.customerId}
              onChange={(e) => setFilter("customerId", e.target.value)}
            />
            <Input
              placeholder="Email"
              className="h-7 text-[11px]"
              value={filters.customerEmail}
              onChange={(e) => setFilter("customerEmail", e.target.value)}
            />
            <Input
              placeholder="Phone"
              className="h-7 text-[11px]"
              value={filters.customerPhone}
              onChange={(e) => setFilter("customerPhone", e.target.value)}
            />
            <div className="flex gap-1.5">
              <Input
                type="date"
                className="h-7 text-[11px] flex-1"
                value={filters.startDate}
                onChange={(e) => setFilter("startDate", e.target.value)}
              />
              <Input
                type="date"
                className="h-7 text-[11px] flex-1"
                value={filters.endDate}
                onChange={(e) => setFilter("endDate", e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded accent-destructive"
                checked={filters.hasError}
                onChange={(e) => setHasErrorFilter(e.target.checked)}
              />
              <ShieldAlert className="w-3 h-3 text-destructive" />
              <span className="text-[11px] text-destructive font-medium">Errors only</span>
            </label>
          </div>

          <ScrollArea className="flex-1">
            <div className="px-2 pt-2 pb-4 space-y-1">
              {sessionsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 w-full animate-pulse bg-muted rounded-md mb-1" />
                ))
              ) : sessions.length === 0 ? (
                <div className="text-center py-10 px-4">
                  <p className="text-sm text-muted-foreground">No sessions found.</p>
                </div>
              ) : (
                <>
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                      className={cn(
                        "group w-full text-left p-3 rounded-md transition-all border",
                        selectedSessionId === s.id
                          ? "bg-primary/10 border-primary shadow-sm"
                          : "border-transparent hover:bg-muted/50 hover:border-border"
                      )}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <p className="font-mono text-[10px] font-bold truncate max-w-[140px]">
                          {s.id}
                        </p>
                        <div className="flex items-center gap-1">
                          {s.hasError && (
                            <Badge variant="destructive" className="text-[9px] h-4 px-1 leading-none gap-0.5">
                              <ShieldAlert className="w-2.5 h-2.5" />
                              {s.errorCount}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[9px] h-4 px-1 leading-none">
                            {s._count.events} ev
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span className="text-[10px]">
                          {new Date(s.createdAt).toLocaleDateString()} {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </button>
                  ))}
                  {hasMore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-8 text-xs text-muted-foreground mt-1"
                      onClick={loadMore}
                    >
                      <ChevronDown className="w-3 h-3 mr-1" /> Load more
                    </Button>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Right Pane: Content */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-50/30">
          {!selectedSessionId ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-60">
              <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center mb-4">
                <Play className="w-8 h-8 text-primary/40" />
              </div>
              <h2 className="text-xl font-semibold mb-2 text-slate-900">No Session Selected</h2>
              <p className="text-sm text-slate-500 max-w-sm">
                Choose a session from the explorer on the left to review interaction data, 
                timeline analysis, and event recordings.
              </p>
            </div>
          ) : (
            <Tabs defaultValue="replay" className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 py-2 border-b bg-card flex items-center justify-between">
                <TabsList className="h-8 bg-muted/50">
                  <TabsTrigger value="replay" className="text-xs data-[state=active]:bg-background">
                    <Play className="w-3 h-3 mr-2" /> Replay
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="text-xs data-[state=active]:bg-background">
                    <History className="w-3 h-3 mr-2" /> Timeline
                  </TabsTrigger>
                  <TabsTrigger value="raw" className="text-xs data-[state=active]:bg-background">
                    <List className="w-3 h-3 mr-2" /> Event Log
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] bg-background">
                    ID: {selectedSessionId}
                  </Badge>
                </div>
              </div>

              <div className="flex-1 overflow-hidden relative">
                <TabsContent value="replay" className="h-full m-0 p-6 flex flex-col items-center justify-center">
                  <Card className="w-full h-full max-w-5xl shadow-xl overflow-hidden border-2 border-primary/5 bg-background flex flex-col">
                    <CardHeader className="py-3 px-4 bg-muted/20 border-b">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Play className="w-4 h-4 text-primary" /> Session Recording
                        </CardTitle>
                        {selectedSession?.userAgent && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-sm">
                            {selectedSession.userAgent}
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 flex-1 relative bg-slate-100">
                      {replayLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-xs">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                            <p className="text-sm font-medium animate-pulse">Buffering Session...</p>
                          </div>
                        </div>
                      ) : replayData?.events && replayData.events.length >= 2 ? (
                        <ReplayViewer events={replayData.events} errorTimestamps={errorTimestamps} />
                      ) : (
                        <div className="flex-1 h-full flex items-center justify-center p-8 text-center">
                          <div className="space-y-4 max-w-xs">
                            <AlertCircle className="w-12 h-12 text-warning mx-auto opacity-50" />
                            <h3 className="text-lg font-semibold">Insufficient Data</h3>
                            <p className="text-sm text-muted-foreground">
                              This session contains only {replayData?.events?.length ?? 0} events, 
                              which is not enough to construct a valid playback recording.
                            </p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="timeline" className="h-full m-0 p-6">
                  <Card className="h-full overflow-hidden flex flex-col">
                    <CardHeader className="py-4 border-b">
                      <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <History className="w-5 h-5 text-green-500" /> Interaction Timeline
                      </CardTitle>
                    </CardHeader>
                    <ScrollArea className="flex-1">
                      <div className="p-6 relative">
                        <div className="absolute left-8 top-0 bottom-0 w-px bg-border" />
                        <div className="space-y-8">
                          {timelineData && timelineData.length > 0 ? (
                            [...timelineData].sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).map((t: any) => (
                              <div key={t.id} className="relative pl-12">
                                <div className={cn(
                                  "absolute left-6 w-4 h-4 rounded-full border-4 border-background -translate-x-1/2 flex items-center justify-center",
                                  t.type.includes("error") ? "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-green-500"
                                )} />
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-[10px] font-mono h-5">
                                      {new Date(t.timestamp).toLocaleTimeString()}
                                    </Badge>
                                    <span className="font-bold text-sm uppercase tracking-wider text-slate-700">
                                      {t.type.replace(/_/g, " ")}
                                    </span>
                                  </div>
                                  <p className="text-sm text-slate-600 leading-relaxed font-normal">
                                    {t.content}
                                  </p>
                                  {t.metadata && (
                                    <pre className="mt-2 p-2 bg-muted rounded text-[10px] text-muted-foreground overflow-auto">
                                      {JSON.stringify(t.metadata, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-20 opacity-50">
                              <History className="w-12 h-12 mx-auto mb-4" />
                              <p>No enriched timeline data available for this session.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </ScrollArea>
                  </Card>
                </TabsContent>

                <TabsContent value="raw" className="h-full m-0 p-6">
                  <Card className="h-full flex flex-col overflow-hidden">
                    <CardHeader className="py-4 border-b bg-muted/30">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                          <List className="w-5 h-5 text-blue-500" /> Event Stream
                        </CardTitle>
                        <Badge variant="secondary" className="font-mono">
                          {replayData?.events?.length ?? 0} Total
                        </Badge>
                      </div>
                    </CardHeader>
                    <ScrollArea className="flex-1">
                      <div className="p-0">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs border-b z-10">
                            <tr>
                              <th className="p-3 font-semibold text-muted-foreground w-16">Seq</th>
                              <th className="p-3 font-semibold text-muted-foreground w-32">Time</th>
                              <th className="p-3 font-semibold text-muted-foreground w-40">Type</th>
                              <th className="p-3 font-semibold text-muted-foreground">Preview</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {replayData?.events?.map((e: any, idx: number) => (
                              <tr key={idx} className="hover:bg-muted/30 transition-colors group">
                                <td className="p-3 font-mono text-muted-foreground">{e.sequence}</td>
                                <td className="p-3 font-mono whitespace-nowrap">
                                  {new Date(e.timestamp).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
                                  <span className="text-[10px] opacity-50">{new Date(e.timestamp).getMilliseconds().toString().padStart(3, '0')}</span>
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-1.5">
                                    {e.type === "rrweb" ? (
                                      <MousePointer2 className="w-3 h-3 text-blue-500" />
                                    ) : (
                                      <AlertCircle className="w-3 h-3 text-amber-500" />
                                    )}
                                    <span className="font-semibold">{e.type}</span>
                                  </div>
                                </td>
                                <td className="p-3 max-w-sm truncate text-muted-foreground">
                                  {typeof e.payload === 'object' ? JSON.stringify(e.payload).slice(0, 100) : String(e.payload)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {(!replayData?.events || replayData.events.length === 0) && (
                          <div className="text-center py-20 text-muted-foreground">
                            No raw events found.
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </Card>
                </TabsContent>
              </div>
            </Tabs>
          )}
        </main>
      </div>
    </div>
  );
}
