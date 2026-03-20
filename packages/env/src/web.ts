import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { NodeEnvSchema } from "./shared";

export const webEnv = createEnv({
  server: {
    NODE_ENV: NodeEnvSchema,
    DATABASE_URL: z.string().url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
