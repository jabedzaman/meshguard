"use client";

import { useState } from "react";
import { cn } from "@meshguard/ui/lib/utils";

/** Monospace text that copies itself on click. */
export function CopyText({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Click to copy"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cn("hover:text-foreground cursor-copy font-mono text-xs", className)}
    >
      {copied ? "copied" : value}
    </button>
  );
}
