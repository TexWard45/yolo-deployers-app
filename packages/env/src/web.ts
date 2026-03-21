import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import {
  NodeEnvSchema,
  DiscordBotTokenSchema,
  DiscordAppIdSchema,
  DiscordWebhookSecretSchema,
  InAppChatSigningSecretSchema,
  LlmApiKeySchema,
  LlmModelDefaultSchema,
  SupportSecretEncryptionKeySchema,
  InternalApiSecretSchema,
  TemporalAddressSchema,
  TemporalNamespaceSchema,
  TemporalTaskQueueSchema,
} from "./shared";

export const webEnv = createEnv({
  server: {
    NODE_ENV: NodeEnvSchema,
    DISCORD_BOT_TOKEN: DiscordBotTokenSchema.optional(),
    DISCORD_APP_ID: DiscordAppIdSchema.optional(),
    DISCORD_WEBHOOK_SECRET: DiscordWebhookSecretSchema.optional(),
    IN_APP_CHAT_SIGNING_SECRET: InAppChatSigningSecretSchema.optional(),
    SUPPORT_SECRET_ENCRYPTION_KEY: SupportSecretEncryptionKeySchema.optional(),
    LLM_API_KEY: LlmApiKeySchema.optional(),
    LLM_MODEL_DEFAULT: LlmModelDefaultSchema,
    // Only consumed server-side (e.g. SSR/API routes)
    DATABASE_URL: z.string().url().optional(),
    TEMPORAL_ADDRESS: TemporalAddressSchema,
    TEMPORAL_NAMESPACE: TemporalNamespaceSchema,
    TEMPORAL_TASK_QUEUE: TemporalTaskQueueSchema,
    INTERNAL_API_SECRET: InternalApiSecretSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env.CI === "true",
});
