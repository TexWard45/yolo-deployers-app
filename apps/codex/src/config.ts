import { codexEnv } from "@shared/env/codex";

export const temporalConfig = {
  address: codexEnv.TEMPORAL_ADDRESS,
  namespace: codexEnv.TEMPORAL_NAMESPACE,
  taskQueue: codexEnv.CODEX_TASK_QUEUE,
};

export const codexConfig = {
  cloneBasePath: codexEnv.CODEX_CLONE_BASE_PATH,
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
