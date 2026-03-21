import { Badge } from "@/components/ui/badge";

interface DraftTypeBadgeProps {
  draftType: string;
}

export function DraftTypeBadge({ draftType }: DraftTypeBadgeProps) {
  if (draftType === "CLARIFICATION") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Clarification</Badge>;
  }
  if (draftType === "RESOLUTION") {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Resolution</Badge>;
  }
  return <Badge variant="secondary">Manual</Badge>;
}
