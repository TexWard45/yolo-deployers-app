import { z } from "zod";

export const NodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

export const TemporalAddressSchema = z.string().default("localhost:7233");
export const TemporalNamespaceSchema = z.string().default("default");
export const TemporalTaskQueueSchema = z.string().default("template-task-queue");
