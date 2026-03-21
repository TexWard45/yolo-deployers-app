"use client";

import type { ReactNode } from "react";

const MENTION_RE = /(@[\w.]+|#[\w-]+)/g;

export function renderMessageBody(body: string): ReactNode[] {
  const parts = body.split(MENTION_RE);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span
          key={i}
          className="inline rounded bg-blue-100 px-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        >
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
