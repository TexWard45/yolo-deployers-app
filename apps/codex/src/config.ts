import { resolve } from "node:path";
import { codexEnv } from "@shared/env/codex";

export const temporalConfig = {
  address: codexEnv.TEMPORAL_ADDRESS,
  namespace: codexEnv.TEMPORAL_NAMESPACE,
  taskQueue: codexEnv.CODEX_TASK_QUEUE,
};

export const codexConfig = {
  cloneBasePath: resolve(codexEnv.CODEX_CLONE_BASE_PATH),
  llm: {
    apiKey: codexEnv.LLM_API_KEY,
    model: codexEnv.LLM_MODEL_DEFAULT,
  },
  webAppUrl: codexEnv.WEB_APP_URL,
  internalApiSecret: codexEnv.INTERNAL_API_SECRET,
  embedding: {
    apiKey: codexEnv.CODEX_EMBEDDING_API_KEY,
    model: codexEnv.CODEX_EMBEDDING_MODEL,
    dimensions: codexEnv.CODEX_EMBEDDING_DIMENSIONS,
  },
  reranker: {
    enabled: codexEnv.CODEX_RERANKER_ENABLED,
    model: codexEnv.CODEX_RERANKER_MODEL,
  },
};
