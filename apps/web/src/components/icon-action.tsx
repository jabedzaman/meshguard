import { Tooltip, TooltipContent, TooltipTrigger } from "@meshguard/ui/components/tooltip";

/** An icon-only control with a tooltip naming it. `children` is the trigger button. */
export function IconAction({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
