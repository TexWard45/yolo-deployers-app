import { createEnv } from "@t3-oss/env-core";
import {
  NodeEnvSchema,
  DiscordBotTokenSchema,
  DiscordAppIdSchema,
  DiscordWebhookSecretSchema,
  InAppChatSigningSecretSchema,
  SupportSecretEncryptionKeySchema,
} from "./shared";

export const webEnv = createEnv({
  server: {
    NODE_ENV: NodeEnvSchema,
    DISCORD_BOT_TOKEN: DiscordBotTokenSchema.optional(),
    DISCORD_APP_ID: DiscordAppIdSchema.optional(),
    DISCORD_WEBHOOK_SECRET: DiscordWebhookSecretSchema.optional(),
    IN_APP_CHAT_SIGNING_SECRET: InAppChatSigningSecretSchema.optional(),
    SUPPORT_SECRET_ENCRYPTION_KEY: SupportSecretEncryptionKeySchema.optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
