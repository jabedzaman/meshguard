import { cn } from "@meshguard/ui/lib/utils";

/** Green and pulsing when online, a quiet grey dot otherwise. */
export function OnlineDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("relative flex size-2.5 shrink-0", className)}>
      {online && (
        <span className="bg-emerald-500 absolute inline-flex size-full animate-ping rounded-full opacity-60" />
      )}
      <span
        className={cn(
          "relative inline-flex size-full rounded-full",
          online ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}
