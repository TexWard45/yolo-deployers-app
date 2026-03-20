export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { trpc } from "@/trpc/server";
import { getSession } from "@/actions/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  FileCode,
  Hash,
  GitBranch,
} from "lucide-react";

interface ChunkViewerPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export default async function ChunkViewerPage({ params }: ChunkViewerPageProps) {
  const { slug, id } = await params;
  const session = await getSession();

  if (!session) redirect("/login");

  let chunk;
  try {
    chunk = await trpc.codex.chunk.get({ id });
  } catch {
    notFound();
  }

  const context = await trpc.codex.chunk.context({ id, before: 3, after: 3 });

  const repoSlug = slug;
  const repoId = chunk.file.repository.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href={`/workspace/${repoSlug}/codex/repository/${repoId}`} />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold tracking-tight">
            {chunk.symbolName ?? "Code Chunk"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {chunk.file.filePath}:{chunk.lineStart}-{chunk.lineEnd}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{chunk.chunkType}</Badge>
        <Badge variant="secondary">{chunk.file.language}</Badge>
        <Badge variant={chunk.embeddingStatus === "EMBEDDED" ? "default" : "secondary"}>
          {chunk.embeddingStatus}
        </Badge>
        {chunk.isAsync && <Badge variant="outline">async</Badge>}
        {chunk.exportType && chunk.exportType !== "none" && (
          <Badge variant="outline">export ({chunk.exportType})</Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Repository</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <GitBranch className="size-4 text-muted-foreground" />
            <Link
              href={`/workspace/${repoSlug}/codex/repository/${repoId}`}
              className="text-sm hover:underline"
            >
              {chunk.file.repository.displayName}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">File</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <FileCode className="size-4 text-muted-foreground" />
            <span className="truncate text-sm font-mono">
              {chunk.file.filePath}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Lines</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Hash className="size-4 text-muted-foreground" />
            <span className="text-sm">
              {chunk.lineStart} - {chunk.lineEnd} ({chunk.lineEnd - chunk.lineStart + 1} lines)
            </span>
          </CardContent>
        </Card>
      </div>

      {(chunk.parameters.length > 0 || chunk.returnType || chunk.docstring) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              {chunk.parameters.length > 0 && (
                <div>
                  <dt className="font-medium text-muted-foreground">Parameters</dt>
                  <dd className="font-mono">{chunk.parameters.join(", ")}</dd>
                </div>
              )}
              {chunk.returnType && (
                <div>
                  <dt className="font-medium text-muted-foreground">Return Type</dt>
                  <dd className="font-mono">{chunk.returnType}</dd>
                </div>
              )}
              {chunk.imports.length > 0 && (
                <div className="md:col-span-2">
                  <dt className="font-medium text-muted-foreground">Imports</dt>
                  <dd className="font-mono text-xs">{chunk.imports.join(", ")}</dd>
                </div>
              )}
              {chunk.docstring && (
                <div className="md:col-span-2">
                  <dt className="font-medium text-muted-foreground">Documentation</dt>
                  <dd className="whitespace-pre-wrap">{chunk.docstring}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Source Code</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-sm">
            <code>{chunk.content}</code>
          </pre>
        </CardContent>
      </Card>

      {(context.before.length > 0 || context.after.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Surrounding Chunks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {context.before.map((c) => (
              <div key={c.id} className="rounded-md border p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {c.chunkType}
                  </Badge>
                  <Link
                    href={`/workspace/${repoSlug}/codex/chunk/${c.id}`}
                    className="text-xs font-medium hover:underline"
                  >
                    {c.symbolName ?? `Lines ${c.lineStart}-${c.lineEnd}`}
                  </Link>
                  <span className="text-xs text-muted-foreground">before</span>
                </div>
                <pre className="overflow-x-auto text-xs text-muted-foreground">
                  <code>{c.content.split("\n").slice(0, 5).join("\n")}</code>
                </pre>
              </div>
            ))}

            {context.current && (
              <div className="rounded-md border-2 border-primary p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge className="text-xs">{context.current.chunkType}</Badge>
                  <span className="text-xs font-medium">
                    {context.current.symbolName ?? `Lines ${context.current.lineStart}-${context.current.lineEnd}`}
                  </span>
                  <span className="text-xs text-muted-foreground">current</span>
                </div>
              </div>
            )}

            {context.after.map((c) => (
              <div key={c.id} className="rounded-md border p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {c.chunkType}
                  </Badge>
                  <Link
                    href={`/workspace/${repoSlug}/codex/chunk/${c.id}`}
                    className="text-xs font-medium hover:underline"
                  >
                    {c.symbolName ?? `Lines ${c.lineStart}-${c.lineEnd}`}
                  </Link>
                  <span className="text-xs text-muted-foreground">after</span>
                </div>
                <pre className="overflow-x-auto text-xs text-muted-foreground">
                  <code>{c.content.split("\n").slice(0, 5).join("\n")}</code>
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
