import { Badge } from "@/components/ui/badge";

interface DraftTypeBadgeProps {
  draftType: string;
}

export function DraftTypeBadge({ draftType }: DraftTypeBadgeProps) {
  if (draftType === "CLARIFICATION") {
    return <Badge variant="amber">Clarification</Badge>;
  }
  if (draftType === "RESOLUTION") {
    return <Badge variant="green">Resolution</Badge>;
  }
  return <Badge variant="cyan">Manual</Badge>;
}
