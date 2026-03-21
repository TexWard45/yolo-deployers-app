import { LayoutDashboard } from "lucide-react";

interface ResolveLogoIconProps {
  className?: string;
}

export function ResolveLogoIcon({ className = "size-4" }: ResolveLogoIconProps) {
  return <LayoutDashboard className={className} />;
}
