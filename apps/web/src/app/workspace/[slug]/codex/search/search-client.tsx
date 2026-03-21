"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, Search, Loader2 } from "lucide-react";
import { SearchResultCard } from "@/components/codex/SearchResultCard";

interface CodexSearchClientProps {
  workspaceId: string;
  workspaceSlug: string;
}

interface SearchResultItem {
  id: string;
  content: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: string;
  chunkType: string;
  symbolName: string | null;
  repoId: string;
  displayName: string;
  sourceType: string;
  score: number;
  matchChannel: string;
}

interface SearchResponse {
  chunks: SearchResultItem[];
  total: number;
  query: string;
  timing: {
    semanticMs: number;
    keywordMs: number;
    symbolMs: number;
    rerankMs: number | null;
    totalMs: number;
  };
}

export function CodexSearchClient({ workspaceId, workspaceSlug }: CodexSearchClientProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [symbolName, setSymbolName] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        workspaceId,
        query: query.trim(),
      };
      if (language.trim()) body["languages"] = [language.trim()];
      if (symbolName.trim()) body["symbolName"] = symbolName.trim();

      const resp = await fetch("/api/rest/codex/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Search failed");
        setLoading(false);
        return;
      }

      const data = await resp.json() as SearchResponse;
      setResults(data);
    } catch {
      setError("Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href={`/workspace/${workspaceSlug}/codex`} />}>
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="gradient-text text-2xl font-bold tracking-tight">Code Search</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search code, functions, types..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={loading || !query.trim()}>
                {loading ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Search className="mr-1 size-4" />
                )}
                Search
              </Button>
            </div>

            <div className="flex gap-4">
              <div className="space-y-1">
                <Label htmlFor="language" className="text-xs">
                  Language
                </Label>
                <Input
                  id="language"
                  placeholder="e.g. typescript"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="h-8 w-40"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="symbolName" className="text-xs">
                  Symbol Name
                </Label>
                <Input
                  id="symbolName"
                  placeholder="e.g. handleSubmit"
                  value={symbolName}
                  onChange={(e) => setSymbolName(e.target.value)}
                  className="h-8 w-40"
                />
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {results.total} results for &ldquo;{results.query}&rdquo;
            </p>
            {results.timing && (
              <div className="flex gap-2">
                <Badge variant="outline" className="text-xs tabular-nums">
                  Total: {results.timing.totalMs}ms
                </Badge>
                <Badge variant="outline" className="text-xs tabular-nums">
                  Semantic: {results.timing.semanticMs}ms
                </Badge>
                <Badge variant="outline" className="text-xs tabular-nums">
                  Keyword: {results.timing.keywordMs}ms
                </Badge>
              </div>
            )}
          </div>

          {results.chunks.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Search className="mb-4 size-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No results found
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {results.chunks.map((result) => (
                <SearchResultCard
                  key={result.id}
                  result={result}
                  workspaceSlug={workspaceSlug}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
