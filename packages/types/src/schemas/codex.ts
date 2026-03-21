import { z } from "zod";

// ── Codex Enums (Zod mirrors of Prisma enums) ──────────────────────

export const CodexSourceTypeSchema = z.enum([
  "GITHUB",
  "GITLAB",
  "BITBUCKET",
  "AZURE_DEVOPS",
  "LOCAL_GIT",
  "ARCHIVE",
]);

export const CodexSyncModeSchema = z.enum(["WEBHOOK", "CRON", "MANUAL"]);

export const CodexChunkTypeSchema = z.enum([
  "FUNCTION",
  "METHOD",
  "CLASS",
  "TYPE",
  "INTERFACE",
  "ENUM",
  "ROUTE_HANDLER",
  "MODULE",
  "FRAGMENT",
]);

// ── Repository ──────────────────────────────────────────────────────

export const CreateCodexRepositorySchema = z.object({
  workspaceId: z.string(),
  sourceType: CodexSourceTypeSchema,
  sourceUrl: z.string().min(1, "Source URL is required"),
  defaultBranch: z.string().default("main"),
  credentials: z.record(z.string(), z.unknown()).nullable().optional(),
  syncMode: CodexSyncModeSchema.default("MANUAL"),
  cronExpression: z.string().nullable().optional(),
  extensionAllowlist: z.array(z.string()).default([]),
  pathDenylist: z.array(z.string()).default([]),
  maxFileSizeBytes: z.number().int().positive().default(1048576),
  displayName: z.string().min(1, "Display name is required"),
  description: z.string().nullable().optional(),
});

export type CreateCodexRepositoryInput = z.infer<typeof CreateCodexRepositorySchema>;

export const UpdateCodexRepositorySchema = z.object({
  id: z.string(),
  defaultBranch: z.string().optional(),
  credentials: z.record(z.string(), z.unknown()).nullable().optional(),
  syncMode: CodexSyncModeSchema.optional(),
  cronExpression: z.string().nullable().optional(),
  extensionAllowlist: z.array(z.string()).optional(),
  pathDenylist: z.array(z.string()).optional(),
  maxFileSizeBytes: z.number().int().positive().optional(),
  displayName: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

export type UpdateCodexRepositoryInput = z.infer<typeof UpdateCodexRepositorySchema>;

// ── Search ──────────────────────────────────────────────────────────

export const CodexSearchSchema = z.object({
  workspaceId: z.string(),
  query: z.string().min(1).max(1000),
  repositoryIds: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  chunkTypes: z.array(CodexChunkTypeSchema).optional(),
  symbolName: z.string().optional(),
  channels: z
    .object({
      semantic: z.boolean().default(true),
      keyword: z.boolean().default(true),
      symbol: z.boolean().default(true),
    })
    .optional(),
  rerank: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type CodexSearchInput = z.infer<typeof CodexSearchSchema>;

// ── Chunk Queries ───────────────────────────────────────────────────

export const CodexChunkQuerySchema = z.object({
  id: z.string(),
});

export type CodexChunkQueryInput = z.infer<typeof CodexChunkQuerySchema>;

export const CodexChunkContextSchema = z.object({
  id: z.string(),
  before: z.number().int().min(0).default(2),
  after: z.number().int().min(0).default(2),
});

export type CodexChunkContextInput = z.infer<typeof CodexChunkContextSchema>;

export const CodexBatchContextSchema = z.object({
  chunkIds: z.array(z.string()).min(1).max(10),
  maxSiblings: z.number().int().min(0).max(5).default(3),
});

export type CodexBatchContextInput = z.infer<typeof CodexBatchContextSchema>;

// ── Sync Logs ───────────────────────────────────────────────────────

export const CodexSyncLogsQuerySchema = z.object({
  repositoryId: z.string(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type CodexSyncLogsQueryInput = z.infer<typeof CodexSyncLogsQuerySchema>;

// ── Stats ───────────────────────────────────────────────────────────

export const CodexStatsQuerySchema = z.object({
  workspaceId: z.string(),
});

export type CodexStatsQueryInput = z.infer<typeof CodexStatsQuerySchema>;

// ── Agent Grep ─────────────────────────────────────────────────────

export const AgentGrepSummarizeInputSchema = z.object({
  taskDescription: z.string().min(1).max(5000),
});

export type AgentGrepSummarizeInput = z.infer<typeof AgentGrepSummarizeInputSchema>;

export const AgentGrepSummarizeResultSchema = z.object({
  summary: z.string(),
  semanticQueries: z.array(z.string()).min(1).max(5),
  keywords: z.array(z.string()).max(10),
  symbolNames: z.array(z.string()).max(10),
  languages: z.array(z.string()).optional(),
  chunkTypes: z.array(CodexChunkTypeSchema).optional(),
});

export type AgentGrepSummarizeResult = z.infer<typeof AgentGrepSummarizeResultSchema>;

export const AgentGrepContextCheckInputSchema = z.object({
  workspaceId: z.string(),
  repositoryId: z.string(),
});

export type AgentGrepContextCheckInput = z.infer<typeof AgentGrepContextCheckInputSchema>;

export const AgentGrepContextCheckResultSchema = z.object({
  ready: z.boolean(),
  repositoryExists: z.boolean(),
  displayName: z.string().nullable(),
  totalChunks: z.number(),
  embeddedChunks: z.number(),
  embeddingCoverage: z.number(),
  syncStatus: z.string().nullable(),
});

export type AgentGrepContextCheckResult = z.infer<typeof AgentGrepContextCheckResultSchema>;

export const AgentGrepInputSchema = z.object({
  workspaceId: z.string(),
  repositoryId: z.string(),
  taskDescription: z.string().min(1).max(5000),
  maxResults: z.number().int().min(1).max(100).default(20),
  rerank: z.boolean().default(false),
});

export type AgentGrepInput = z.infer<typeof AgentGrepInputSchema>;

export const AgentGrepResultSchema = z.object({
  summary: AgentGrepSummarizeResultSchema,
  context: AgentGrepContextCheckResultSchema,
  chunks: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      symbolName: z.string().nullable(),
      chunkType: z.string(),
      lineStart: z.number(),
      lineEnd: z.number(),
      filePath: z.string(),
      language: z.string(),
      lastAuthor: z.string().nullable(),
      lastCommitSha: z.string().nullable(),
      lastCommitAt: z.coerce.date().nullable(),
      repoId: z.string(),
      displayName: z.string(),
      sourceType: z.string(),
      score: z.number(),
      matchChannel: z.string(),
    }),
  ),
  totalFound: z.number(),
  timing: z.object({
    summarizeMs: z.number(),
    contextCheckMs: z.number(),
    searchMs: z.number(),
    totalMs: z.number(),
  }),
});

export type AgentGrepResult = z.infer<typeof AgentGrepResultSchema>;
