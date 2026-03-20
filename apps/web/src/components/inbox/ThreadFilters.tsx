"use client";

import { Button } from "@/components/ui/button";
import { THREAD_STATUS_LABEL, THREAD_STATUSES, type ThreadStatusValue } from "./thread-status";

interface ThreadFiltersProps {
  value: ThreadStatusValue | "ALL";
  onChange: (next: ThreadStatusValue | "ALL") => void;
}

export function ThreadFilters({ value, onChange }: ThreadFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant={value === "ALL" ? "default" : "outline"}
        onClick={() => onChange("ALL")}
      >
        All
      </Button>
      {THREAD_STATUSES.map((status) => (
        <Button
          key={status}
          type="button"
          size="sm"
          variant={value === status ? "default" : "outline"}
          onClick={() => onChange(status)}
        >
          {THREAD_STATUS_LABEL[status]}
        </Button>
      ))}
    </div>
  );
}
