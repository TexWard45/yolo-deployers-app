import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import {
  NodeEnvSchema,
  TemporalAddressSchema,
  TemporalNamespaceSchema,
} from "./shared";

export const codexEnv = createEnv({
  server: {
    NODE_ENV: NodeEnvSchema,
    TEMPORAL_ADDRESS: TemporalAddressSchema,
    TEMPORAL_NAMESPACE: TemporalNamespaceSchema,
    CODEX_TASK_QUEUE: z.string().default("codex-sync-queue"),
    CODEX_EMBEDDING_API_KEY: z.string().min(1),
    CODEX_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
    CODEX_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
    CODEX_CLONE_BASE_PATH: z.string().min(1),
    CODEX_RERANKER_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    CODEX_RERANKER_MODEL: z.string().default("rerank-v3.5"),
    COHERE_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
