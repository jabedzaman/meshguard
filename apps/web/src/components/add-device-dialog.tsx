"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getErrorMessage } from "@mesh/api-client";
import { Button } from "@mesh/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@mesh/ui/components/dialog";
import { Label } from "@mesh/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mesh/ui/components/select";
import { CopyButton } from "~/components/copy-button";
import { usePermission } from "~/components/providers/organization-provider";
import {
  enrollmentTokenMutations,
  enrollmentTokenQueries,
  type EnrollmentTokenTtl,
} from "~/lib/queries";

const EXPIRY_OPTIONS: { value: EnrollmentTokenTtl; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

export function AddDeviceDialog({ networkId }: { networkId: string }) {
  const canEnroll = usePermission({ device: ["create"] });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expiresIn, setExpiresIn] = useState<EnrollmentTokenTtl>("1h");

  const create = useMutation({
    mutationFn: () => enrollmentTokenMutations.create(networkId, expiresIn),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: enrollmentTokenQueries.all() }),
  });

  if (!canEnroll) return null;

  const command = create.data ? `mesh up --token ${create.data.token}` : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // The token is only ever shown once; forget it when the dialog closes.
        if (!next) create.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Add device</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a device</DialogTitle>
          <DialogDescription>
            Create a one-time token, then run the command on the device you want to add.
          </DialogDescription>
        </DialogHeader>

        {create.data ? (
          <div className="flex flex-col gap-3">
            <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
              {command}
            </pre>
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                This token won&apos;t be shown again. It works once and expires{" "}
                {new Date(create.data.expiresAt).toLocaleString()}.
              </p>
              <CopyButton value={command} label="Copy command" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="token-expiry">Token expires after</Label>
            <Select
              value={expiresIn}
              onValueChange={(value) => setExpiresIn(value as EnrollmentTokenTtl)}
            >
              <SelectTrigger id="token-expiry" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {create.error && (
              <p role="alert" className="text-destructive text-sm">
                {getErrorMessage(create.error)}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {create.data ? (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create token"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
