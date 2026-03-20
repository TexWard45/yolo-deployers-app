import { z } from "zod";

// ── User ────────────────────────────────────────────────────────────
export const CreateUserSchema = z.object({
  username: z.string().min(3).max(32),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().nullable().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// ── Auth ────────────────────────────────────────────────────────────
export const LoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const SignupSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(32),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ── Workspace ───────────────────────────────────────────────────────
export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1, "Workspace name is required"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(32)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const AddWorkspaceMemberSchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
});

export type AddWorkspaceMemberInput = z.infer<typeof AddWorkspaceMemberSchema>;

// ── Post ────────────────────────────────────────────────────────────
export const CreatePostSchema = z.object({
  title: z.string().min(1),
  content: z.string().nullable().optional(),
  published: z.boolean().default(false),
  authorId: z.string(),
  workspaceId: z.string(),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;

// ── Codex ──────────────────────────────────────────────────────────
export * from "./codex";
