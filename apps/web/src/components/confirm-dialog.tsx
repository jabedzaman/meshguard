"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@meshguard/ui/components/alert-dialog";
import { FormSubmit } from "~/components/form-submit";
import { IconAction } from "~/components/icon-action";

/**
 * Confirmation for destructive actions. Stays open while `onConfirm` runs and
 * shows its error, so the user sees why it failed.
 */
export function ConfirmDialog({
  trigger,
  triggerTooltip,
  title,
  description,
  onConfirm,
  variant = "destructive",
}: {
  trigger: React.ReactNode;
  /** Names an icon-only trigger. */
  triggerTooltip?: string;
  title: string;
  description: React.ReactNode;
  onConfirm: () => Promise<unknown>;
  /** Destructive (red) by default; use "default" for actions that aren't. */
  variant?: "default" | "destructive";
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {triggerTooltip ? (
        <IconAction label={triggerTooltip}>
          <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
        </IconAction>
      ) : (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      )}
      <AlertDialogContent>
        {/* display: contents keeps the dialog's layout; the form makes Enter confirm. */}
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <FormSubmit
              variant="destructive"
              pending={pending}
              onCancel={() => {
                setOpen(false);
                setError(null);
              }}
            />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
