import { createEnv } from "@t3-oss/env-core";
import {
  NodeEnvSchema,
  TemporalAddressSchema,
  TemporalNamespaceSchema,
  TemporalTaskQueueSchema,
} from "./shared";

export const queueEnv = createEnv({
  server: {
    NODE_ENV: NodeEnvSchema,
    TEMPORAL_ADDRESS: TemporalAddressSchema,
    TEMPORAL_NAMESPACE: TemporalNamespaceSchema,
    TEMPORAL_TASK_QUEUE: TemporalTaskQueueSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
