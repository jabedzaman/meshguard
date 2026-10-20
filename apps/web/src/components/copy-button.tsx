"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@meshguard/ui/components/button";

/** navigator.clipboard only exists on secure origins; fall back to a hidden textarea on plain http. */
async function writeClipboard(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    if (!document.execCommand("copy")) throw new Error("copy failed");
  } finally {
    field.remove();
  }
}

export function CopyButton({
  value,
  label = "Copy",
  onCopy,
}: {
  value: string;
  label?: string;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await writeClipboard(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        onCopy?.();
      }}
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}
