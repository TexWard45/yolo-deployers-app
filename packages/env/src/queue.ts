import { createEnv } from "@t3-oss/env-core";
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
    LLM_API_KEY: LlmApiKeySchema.optional(),
    LLM_MODEL_DEFAULT: LlmModelDefaultSchema,
    DISCORD_BOT_TOKEN: DiscordBotTokenSchema.optional(),
    SUPPORT_SECRET_ENCRYPTION_KEY: SupportSecretEncryptionKeySchema.optional(),
    WEB_APP_URL: WebAppUrlSchema,
    INTERNAL_API_SECRET: InternalApiSecretSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
