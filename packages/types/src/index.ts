// Prisma model types
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
  ChannelConnection,
  CustomerProfile,
  CustomerChannelIdentity,
  Conversation,
  ConversationMessage,
  ReplyDraft,
  WorkspaceAgentConfig,
  ChannelType,
  SenderKind,
  DraftStatus,
} from "./prisma-generated/client";

// Prisma generated input/output types and enums
export type * from "./prisma-generated/models";
export type * from "./prisma-generated/enums";

// Zod schemas
export * from "./schemas";
