import { z } from "zod";

export const NodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

export const TemporalAddressSchema = z.string().default("localhost:7233");
export const TemporalNamespaceSchema = z.string().default("default");
export const TemporalTaskQueueSchema = z.string().default("template-task-queue");

// Support / AI agent env schemas
export const LlmApiKeySchema = z.string().min(1);
export const LlmModelDefaultSchema = z.string().default("claude-sonnet-4-20250514");
export const DiscordBotTokenSchema = z.string().min(1);
export const DiscordAppIdSchema = z.string().min(1);
export const DiscordWebhookSecretSchema = z.string().min(1);
export const InAppChatSigningSecretSchema = z.string().min(1);
export const SupportSecretEncryptionKeySchema = z.string().min(1);
