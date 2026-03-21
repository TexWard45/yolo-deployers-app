import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import {
  NodeEnvSchema,
  TemporalAddressSchema,
  TemporalNamespaceSchema,
  TemporalTaskQueueSchema,
  LlmApiKeySchema,
  LlmModelDefaultSchema,
  DiscordBotTokenSchema,
  SupportSecretEncryptionKeySchema,
  WebAppUrlSchema,
  InternalApiSecretSchema,
} from "./shared";

export const queueEnv = createEnv({
  server: {
    NODE_ENV: NodeEnvSchema,
    TEMPORAL_ADDRESS: TemporalAddressSchema,
    TEMPORAL_NAMESPACE: TemporalNamespaceSchema,
    TEMPORAL_TASK_QUEUE: TemporalTaskQueueSchema,
    LLM_API_KEY: LlmApiKeySchema,
    LLM_MODEL_DEFAULT: LlmModelDefaultSchema,
    DISCORD_BOT_TOKEN: DiscordBotTokenSchema.optional(),
    SUPPORT_SECRET_ENCRYPTION_KEY: SupportSecretEncryptionKeySchema.optional(),
    WEB_APP_URL: WebAppUrlSchema,
    INTERNAL_API_SECRET: InternalApiSecretSchema,
    // Optional global Sentry fallback used by queue investigations.
    GLOBAL_SENTRY_ORG_SLUG: z.string().min(1).optional(),
    GLOBAL_SENTRY_PROJECT_SLUG: z.string().min(1).optional(),
    GLOBAL_SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
    // Aliases for existing Sentry env naming.
    SENTRY_ORG: z.string().min(1).optional(),
    SENTRY_PROJECT: z.string().min(1).optional(),
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
