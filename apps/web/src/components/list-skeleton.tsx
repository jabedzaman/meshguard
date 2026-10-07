import { Skeleton } from "@meshguard/ui/components/skeleton";

/** Placeholder rows shaped like the bordered lists they stand in for. */
export function ListSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="divide-border bg-card divide-y rounded-xl border"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="size-8 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
