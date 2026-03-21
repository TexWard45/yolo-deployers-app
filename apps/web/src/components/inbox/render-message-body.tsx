import type { ReactNode } from "react";

export interface MentionInfo {
  avatarUrl?: string;
}

export type MentionsMap = Record<string, MentionInfo>;

const MENTION_RE = /(@[\w.]+|#[\w-]+)/g;

export function renderMessageBody(
  body: string,
  mentions?: MentionsMap,
): ReactNode[] {
  const parts = body.split(MENTION_RE);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      const name = part.slice(1);
      const mention = mentions?.[name];
      return (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        >
          {mention?.avatarUrl ? (
            <img
              src={mention.avatarUrl}
              alt={name}
              className="inline-block size-3.5 rounded-full"
            />
          ) : null}
          {part}
        </span>
      );
    }
    if (part.startsWith("#")) {
      return (
        <span
          key={i}
          className="inline rounded bg-gray-100 px-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}
