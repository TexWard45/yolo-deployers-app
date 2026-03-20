// Prisma model types (User, Post, etc.)
export type {
  User,
  Post,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  Customer,
  SupportThread,
  ThreadMessage,
  ThreadStatus,
  MessageDirection,
  CustomerSource,
} from "./prisma-generated/client";

// Prisma generated input/output types and enums
export type * from "./prisma-generated/models";
export type * from "./prisma-generated/enums";

// Zod schemas
export * from "./schemas";
