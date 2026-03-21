import type { ReactNode } from "react";

export interface MentionInfo {
  avatarUrl?: string;
}

export type MentionsMap = Record<string, MentionInfo>;

export interface AttachmentInfo {
  url: string;
  name?: string;
  contentType?: string;
}

const MENTION_RE = /(@[\w.]+|#[\w-]+)/g;
const URL_RE = /(https?:\/\/[^\s<>"')]+)(?=[\s)]|$)/g;

function linkifyText(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(URL_RE);
  const nodes: ReactNode[] = [];

  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("http://") || part.startsWith("https://")) {
      nodes.push(
        <a
          key={`${keyPrefix}-url-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
        >
          {part}
        </a>,
      );
      return;
    }

    nodes.push(part);
  });

  return nodes;
}

export function renderMessageBody(
  body: string,
  mentions?: MentionsMap,
  attachments?: AttachmentInfo[],
): ReactNode[] {
  const parts = body.split(MENTION_RE);
  const nodes: ReactNode[] = [];

  parts.forEach((part, i) => {
    if (!part) return;

    if (part.startsWith("@")) {
      const mention = mentions?.[part.slice(1)];
      nodes.push(
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        >
          {mention && "avatarUrl" in mention && mention.avatarUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={mention.avatarUrl}
              alt={part.slice(1)}
              className="inline-block size-3.5 rounded-full"
            />
          ) : null}
          {part}
        </span>,
      );
      return;
    }

    if (part.startsWith("#")) {
      nodes.push(
        <span
          key={i}
          className="inline rounded bg-gray-100 px-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {part}
        </span>,
      );
      return;
    }

    nodes.push(...linkifyText(part, `text-${i}`));
  });

  if (attachments && attachments.length > 0) {
    nodes.push(
      <span key="attachments" className="mt-2 flex flex-wrap gap-2">
        {attachments.map((att, i) => (
          <a key={i} href={att.url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={att.url}
              alt={att.name ?? "attachment"}
              className="max-h-60 max-w-full rounded-md border"
            />
          </a>
        ))}
      </span>,
    );
  }

  return nodes;
}
