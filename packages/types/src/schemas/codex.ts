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
