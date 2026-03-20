export const THREAD_STATUSES = [
  "NEW",
  "WAITING_REVIEW",
  "WAITING_CUSTOMER",
  "ESCALATED",
  "IN_PROGRESS",
  "CLOSED",
] as const;

export type ThreadStatusValue = (typeof THREAD_STATUSES)[number];

export const THREAD_STATUS_LABEL: Record<ThreadStatusValue, string> = {
  NEW: "New",
  WAITING_REVIEW: "Waiting Review",
  WAITING_CUSTOMER: "Waiting Customer",
  ESCALATED: "Escalated",
  IN_PROGRESS: "In Progress",
  CLOSED: "Closed",
};
