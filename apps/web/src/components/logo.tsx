import { WaypointsIcon } from "lucide-react";
import { cn } from "@meshguard/ui/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg",
        className,
      )}
    >
      <WaypointsIcon className="size-4" />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      <LogoMark />
      MeshGuard
    </span>
  );
}
