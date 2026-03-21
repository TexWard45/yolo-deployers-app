import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@shared/types/prisma";
import OpenAI from "openai";
import { createTRPCRouter, publicProcedure } from "../../init";
import {
  CreateCodexRepositorySchema,
  UpdateCodexRepositorySchema,
  CodexSearchSchema,
  CodexChunkQuerySchema,
  CodexChunkContextSchema,
  CodexBatchContextSchema,
  CodexSyncLogsQuerySchema,
  CodexStatsQuerySchema,
  AgentGrepSummarizeInputSchema,
  AgentGrepContextCheckInputSchema,
  AgentGrepInputSchema,
} from "@shared/types";
import { hybridSearch } from "./search";
import type { EmbedQueryFn } from "./search";
import { createCronSchedule, updateCronSchedule, deleteCronSchedule } from "./schedule";
import { llmSummarizeTask } from "./agent-grep.prompt";
import { checkRepositoryContext, grepRelevantCode } from "./agent-grep";
import { randomBytes } from "node:crypto";

function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

// ── OpenAI client (lazy singleton) ───────────────────────────────────
// Deferred until first use so Next.js build doesn't throw when env vars
// are absent, while still reusing the client (and its connection pool)
// across all subsequent requests.

let _openaiClient: OpenAI | undefined;
let _embeddingModel: string | undefined;
let _embeddingDimensions: number | undefined;

function getEmbedClient(): { client: OpenAI; model: string; dimensions: number } {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: process.env["CODEX_EMBEDDING_API_KEY"] });
    _embeddingModel = process.env["CODEX_EMBEDDING_MODEL"] ?? "text-embedding-3-small";
    _embeddingDimensions = Number(process.env["CODEX_EMBEDDING_DIMENSIONS"] ?? "1536");
  }
  return { client: _openaiClient, model: _embeddingModel!, dimensions: _embeddingDimensions! };
}

const embedQuery: EmbedQueryFn = async (text: string): Promise<number[]> => {
  const { client, model, dimensions } = getEmbedClient();
  const response = await client.embeddings.create({ model, input: text, dimensions });
  return response.data[0]!.embedding;
};

async function startSyncWorkflow(repositoryId: string): Promise<string> {
  const { Client, Connection } = await import("@temporalio/client");

  const address = process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
  const namespace = process.env["TEMPORAL_NAMESPACE"] ?? "default";
  const taskQueue = process.env["CODEX_TASK_QUEUE"] ?? "codex-sync-queue";

  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  const workflowId = `codex-sync-${repositoryId}-${Date.now()}`;

  const handle = await client.workflow.start<
    (input: { repositoryId: string }) => Promise<unknown>
  >("syncRepoWorkflow", {
    args: [{ repositoryId }],
    taskQueue,
    workflowId,
  });

  return handle.workflowId;
}

// ── Repository Sub-Router ────────────────────────────────────────────

const repositoryRouter = createTRPCRouter({
  create: publicProcedure
    .input(CreateCodexRepositorySchema)
    .mutation(async ({ ctx, input }) => {
      const repo = await ctx.prisma.codexRepository.create({
        data: {
          workspaceId: input.workspaceId,
          sourceType: input.sourceType,
          sourceUrl: input.sourceUrl,
          defaultBranch: input.defaultBranch,
          credentials: input.credentials === null
            ? Prisma.JsonNull
            : input.credentials === undefined
              ? undefined
              : (input.credentials as Prisma.InputJsonValue),
          syncMode: input.syncMode,
          cronExpression: input.cronExpression ?? null,
          webhookSecret: input.syncMode === "WEBHOOK" ? generateWebhookSecret() : null,
          extensionAllowlist: input.extensionAllowlist,
          pathDenylist: input.pathDenylist,
          maxFileSizeBytes: input.maxFileSizeBytes,
          displayName: input.displayName,
          description: input.description ?? null,
        },
      });

      if (input.syncMode === "CRON" && input.cronExpression) {
        await createCronSchedule(repo.id, input.cronExpression);
      }

      return repo;
    }),

  list: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.prisma.codexRepository.findMany({
        where: { workspaceId: input.workspaceId },
        include: {
          _count: { select: { files: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.prisma.codexRepository.findUnique({
        where: { id: input.id },
        include: {
          _count: { select: { files: true, syncs: true } },
        },
      });

      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }

      return repo;
    }),

  update: publicProcedure
    .input(UpdateCodexRepositorySchema)
    .mutation(async ({ ctx, input }) => {
      const { id, credentials, ...rest } = input;

      const existing = await ctx.prisma.codexRepository.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }

      const newSyncMode = rest.syncMode ?? existing.syncMode;

      // Generate a webhook secret when switching to WEBHOOK mode
      const webhookSecretUpdate =
        newSyncMode === "WEBHOOK" && !existing.webhookSecret
          ? { webhookSecret: generateWebhookSecret() }
          : newSyncMode !== "WEBHOOK" && existing.webhookSecret
            ? { webhookSecret: null }
            : {};

      const updated = await ctx.prisma.codexRepository.update({
        where: { id },
        data: {
          ...rest,
          ...webhookSecretUpdate,
          ...(credentials !== undefined && {
            credentials: credentials === null
              ? Prisma.JsonNull
              : (credentials as Prisma.InputJsonValue),
          }),
        },
      });
      const newCronExpr = rest.cronExpression !== undefined
        ? rest.cronExpression
        : existing.cronExpression;

      if (newSyncMode === "CRON" && newCronExpr) {
        await updateCronSchedule(id, newCronExpr);
      } else if (existing.syncMode === "CRON" && newSyncMode !== "CRON") {
        await deleteCronSchedule(id);
      }

      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.codexRepository.findUnique({
        where: { id: input.id },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }

      if (existing.syncMode === "CRON") {
        await deleteCronSchedule(input.id);
      }

      await ctx.prisma.codexRepository.delete({ where: { id: input.id } });
      return { id: input.id, deleted: true };
    }),

  sync: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const repo = await ctx.prisma.codexRepository.findUnique({
        where: { id: input.id },
      });

      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }

      if (repo.syncStatus === "SYNCING") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Repository is already syncing",
        });
      }

      const workflowId = await startSyncWorkflow(input.id);

      return { repositoryId: input.id, workflowId, status: "STARTED" };
    }),
});

// ── Chunk Sub-Router ─────────────────────────────────────────────────

const chunkRouter = createTRPCRouter({
  get: publicProcedure
    .input(CodexChunkQuerySchema)
    .query(async ({ ctx, input }) => {
      const chunk = await ctx.prisma.codexChunk.findUnique({
        where: { id: input.id },
        include: {
          file: {
            include: {
              repository: {
                select: {
                  id: true,
                  displayName: true,
                  sourceType: true,
                  sourceUrl: true,
                },
              },
            },
          },
        },
      });

      if (!chunk) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Chunk not found" });
      }

      return chunk;
    }),

  context: publicProcedure
    .input(CodexChunkContextSchema)
    .query(async ({ ctx, input }) => {
      const chunk = await ctx.prisma.codexChunk.findUnique({
        where: { id: input.id },
        select: { fileId: true, lineStart: true },
      });

      if (!chunk) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Chunk not found" });
      }

      const surrounding = await ctx.prisma.codexChunk.findMany({
        where: { fileId: chunk.fileId },
        orderBy: { lineStart: "asc" },
        include: {
          file: {
            select: { filePath: true, language: true },
          },
        },
      });

      const currentIndex = surrounding.findIndex((c) => c.id === input.id);
      if (currentIndex === -1) {
        return { before: [], current: null, after: [] };
      }

      const startIdx = Math.max(0, currentIndex - input.before);
      const endIdx = Math.min(surrounding.length - 1, currentIndex + input.after);

      return {
        before: surrounding.slice(startIdx, currentIndex),
        current: surrounding[currentIndex]!,
        after: surrounding.slice(currentIndex + 1, endIdx + 1),
      };
    }),

  batchContext: publicProcedure
    .input(CodexBatchContextSchema)
    .query(async ({ ctx, input }) => {
      // Fetch all requested chunks with their parent info in one query
      const chunks = await ctx.prisma.codexChunk.findMany({
        where: { id: { in: input.chunkIds } },
        select: {
          id: true,
          parentChunkId: true,
          fileId: true,
          symbolName: true,
          chunkType: true,
          content: true,
          lineStart: true,
          lineEnd: true,
          file: { select: { filePath: true, language: true } },
        },
      });

      // Collect all parent chunk IDs + file IDs for batch fetching
      const parentIds = new Set<string>();
      const fileIds = new Set<string>();
      for (const chunk of chunks) {
        if (chunk.parentChunkId) parentIds.add(chunk.parentChunkId);
        fileIds.add(chunk.fileId);
      }

      // Batch fetch parents + siblings in parallel
      const [parents, siblings] = await Promise.all([
        parentIds.size > 0
          ? ctx.prisma.codexChunk.findMany({
              where: { id: { in: [...parentIds] } },
              select: {
                id: true,
                symbolName: true,
                chunkType: true,
                content: true,
                lineStart: true,
                lineEnd: true,
                file: { select: { filePath: true, language: true } },
              },
            })
          : Promise.resolve([]),
        parentIds.size > 0
          ? ctx.prisma.codexChunk.findMany({
              where: {
                parentChunkId: { in: [...parentIds] },
                id: { notIn: input.chunkIds },
              },
              select: {
                id: true,
                parentChunkId: true,
                symbolName: true,
                chunkType: true,
                content: true,
                lineStart: true,
                lineEnd: true,
                file: { select: { filePath: true, language: true } },
              },
              orderBy: { lineStart: "asc" },
            })
          : Promise.resolve([]),
      ]);

      const parentMap = new Map(parents.map((p) => [p.id, p]));
      const siblingsByParent = new Map<string, typeof siblings>();
      for (const sib of siblings) {
        if (!sib.parentChunkId) continue;
        const list = siblingsByParent.get(sib.parentChunkId) ?? [];
        list.push(sib);
        siblingsByParent.set(sib.parentChunkId, list);
      }

      // Build result per chunk
      const result: Record<string, {
        parent: typeof parents[number] | null;
        siblings: typeof siblings;
      }> = {};

      for (const chunk of chunks) {
        if (!chunk.parentChunkId) {
          result[chunk.id] = { parent: null, siblings: [] };
          continue;
        }

        const parent = parentMap.get(chunk.parentChunkId) ?? null;
        const allSiblings = siblingsByParent.get(chunk.parentChunkId) ?? [];
        result[chunk.id] = {
          parent,
          siblings: allSiblings.slice(0, input.maxSiblings),
        };
      }

      return result;
    }),
});

// ── Sync Sub-Router ──────────────────────────────────────────────────

const syncRouter = createTRPCRouter({
  logs: publicProcedure
    .input(CodexSyncLogsQuerySchema)
    .query(({ ctx, input }) => {
      return ctx.prisma.codexSyncLog.findMany({
        where: { repositoryId: input.repositoryId },
        orderBy: { startedAt: "desc" },
        take: input.limit,
      });
    }),
});

// ── Agent Sub-Router ────────────────────────────────────────────────

const agentRouter = createTRPCRouter({
  summarize: publicProcedure
    .input(AgentGrepSummarizeInputSchema)
    .mutation(async ({ input }) => {
      const { client } = getEmbedClient();
      const result = await llmSummarizeTask(input.taskDescription, client);
      if (!result) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to summarize task — LLM call timed out or failed",
        });
      }
      return result;
    }),

  checkContext: publicProcedure
    .input(AgentGrepContextCheckInputSchema)
    .query(({ ctx, input }) => {
      return checkRepositoryContext(ctx.prisma, input);
    }),

  grepRelevantCode: publicProcedure
    .input(AgentGrepInputSchema)
    .mutation(({ ctx, input }) => {
      const { client } = getEmbedClient();
      return grepRelevantCode(ctx.prisma, input, embedQuery, client);
    }),
});

// ── Main Codex Router ────────────────────────────────────────────────

export const codexRouter = createTRPCRouter({
  repository: repositoryRouter,
  chunk: chunkRouter,
  sync: syncRouter,
  agent: agentRouter,

  search: publicProcedure
    .input(CodexSearchSchema)
    .query(({ ctx, input }) => {
      return hybridSearch(ctx.prisma, input, embedQuery);
    }),

  stats: publicProcedure
    .input(CodexStatsQuerySchema)
    .query(async ({ ctx, input }) => {
      const [repositories, files, chunks, embeddedChunks] = await Promise.all([
        ctx.prisma.codexRepository.count({
          where: { workspaceId: input.workspaceId },
        }),
        ctx.prisma.codexFile.count({
          where: { repository: { workspaceId: input.workspaceId } },
        }),
        ctx.prisma.codexChunk.count({
          where: { file: { repository: { workspaceId: input.workspaceId } } },
        }),
        ctx.prisma.codexChunk.count({
          where: {
            file: { repository: { workspaceId: input.workspaceId } },
            embeddingStatus: "EMBEDDED",
          },
        }),
      ]);

      return { repositories, files, chunks, embeddedChunks };
    }),
});
