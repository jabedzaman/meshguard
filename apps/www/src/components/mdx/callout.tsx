import { cn } from "@meshguard/ui/lib/utils";

interface CalloutProps {
  title?: string;
  type?: "default" | "warning" | "danger";
  children: React.ReactNode;
}

export function Callout({ title, type = "default", children }: CalloutProps) {
  return (
    <div
      className={cn(
        "not-prose my-6 rounded-lg border px-4 py-3 text-sm",
        type === "default" && "bg-muted/50",
        type === "warning" && "border-amber-500/30 bg-amber-500/10",
        type === "danger" && "border-destructive/30 bg-destructive/10",
      )}
    >
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="leading-6 text-muted-foreground [&_code]:font-mono [&_code]:text-foreground [&>p]:my-0">
        {children}
      </div>
    </div>
  );
}
