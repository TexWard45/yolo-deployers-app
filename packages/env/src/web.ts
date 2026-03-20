import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import {
  NodeEnvSchema,
  TemporalAddressSchema,
  TemporalNamespaceSchema,
  TemporalTaskQueueSchema,
} from "./shared";

export const webEnv = createEnv({
  server: {
    NODE_ENV: NodeEnvSchema,
    // Only consumed server-side (e.g. SSR/API routes)
    DATABASE_URL: z.string().url(),
    TEMPORAL_ADDRESS: TemporalAddressSchema,
    TEMPORAL_NAMESPACE: TemporalNamespaceSchema,
    TEMPORAL_TASK_QUEUE: TemporalTaskQueueSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env.CI === "true",
});
