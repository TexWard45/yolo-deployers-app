import { createEnv } from "@t3-oss/env-core";
import { NodeEnvSchema } from "./shared";

export const webEnv = createEnv({
  server: {
    NODE_ENV: NodeEnvSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
