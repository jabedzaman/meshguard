"use client";

import { Loader2Icon } from "lucide-react";
import { Button } from "@meshguard/ui/components/button";

/**
 * The cancel and confirm buttons of a dialog or form. While `pending` the
 * confirm button shows a spinner and both buttons are disabled, so the action
 * can't run twice or be dismissed halfway.
 */
export function FormSubmit({
  onSubmit,
  onCancel,
  pending = false,
  disabled = false,
  variant = "default",
  submitLabel = "Confirm",
  cancelLabel = "Cancel",
}: {
  /** Omit inside a <form>: Confirm then submits the form. */
  onSubmit?: () => void | Promise<unknown>;
  onCancel: () => void;
  pending?: boolean;
  disabled?: boolean;
  variant?: "default" | "destructive";
  submitLabel?: string;
  cancelLabel?: string;
}) {
  return (
    <>
      <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        type={onSubmit ? "button" : "submit"}
        variant={variant}
        disabled={pending || disabled}
        aria-busy={pending}
        onClick={onSubmit && (() => void onSubmit())}
      >
        {pending && <Loader2Icon className="animate-spin" aria-hidden />}
        {submitLabel}
      </Button>
    </>
  );
}
