import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { FileCode, Hash } from "lucide-react";

interface SearchResultCardProps {
  result: {
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
  };
  workspaceSlug: string;
}

export function SearchResultCard({ result, workspaceSlug }: SearchResultCardProps) {
  const lines = result.content.split("\n");
  const preview = lines.slice(0, 15).join("\n");
  const truncated = lines.length > 15;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              {result.symbolName && (
                <Link
                  href={`/workspace/${workspaceSlug}/codex/chunk/${result.id}`}
                  className="font-mono text-sm font-semibold hover:underline"
                >
                  {result.symbolName}
                </Link>
              )}
              <Badge variant="outline" className="text-xs">
                {result.chunkType}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileCode className="size-3" />
                {result.displayName}
              </span>
              <span className="flex items-center gap-1">
                <Hash className="size-3" />
                {result.filePath}:{result.lineStart}-{result.lineEnd}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="secondary" className="text-xs">
              {result.language}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {(result.score * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
          <code>{preview}{truncated ? "\n..." : ""}</code>
        </pre>
        <div className="mt-2 flex items-center gap-1">
          {result.matchChannel.split(",").map((ch) => (
            <Badge key={ch.trim()} variant="outline" className="text-xs">
              {ch.trim()}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
