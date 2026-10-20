"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import { getErrorMessage } from "@meshguard/api-client";
import { Button } from "@meshguard/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@meshguard/ui/components/dialog";
import { Switch } from "@meshguard/ui/components/switch";
import { Input } from "@meshguard/ui/components/input";
import { Label } from "@meshguard/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@meshguard/ui/components/select";
import { FormSubmit } from "~/components/form-submit";
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
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

export function AddDeviceDialog() {
  const canEnroll = usePermission({ device: ["create"] });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const canTag = usePermission({ device: ["update"] });
  const [expiresIn, setExpiresIn] = useState<EnrollmentTokenTtl>("1h");
  const [reusable, setReusable] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);
  const [preApproved, setPreApproved] = useState(true);
  const [tags, setTags] = useState("");

  const create = useMutation({
    mutationFn: () =>
      enrollmentTokenMutations.create({
        expiresIn,
        reusable,
        ephemeral,
        // Members never see the switch, and only admins may pre-approve.
        preApproved: canTag && preApproved,
        tags: tags
          .split(/[\s,]+/)
          .map((tag) => tag.replace(/^tag:/, ""))
          .filter(Boolean),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: enrollmentTokenQueries.all() }),
  });

  if (!canEnroll) return null;

  // Every way of closing goes through here: the token is only ever shown once,
  // so forget it (and the choices made for it) whenever the dialog closes.
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      create.reset();
      setReusable(false);
      setEphemeral(false);
      setPreApproved(true);
      setTags("");
    }
  };

  const command = create.data ? `meshguard up --token ${create.data.token}` : "";

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          Add device
        </Button>
      </DialogTrigger>
      <DialogContent>
        {/* display: contents keeps the dialog's layout; the form makes Enter create the token. */}
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!create.data) create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a device</DialogTitle>
            <DialogDescription>
              Create a one-time token, then run the command on the device you want to add.
            </DialogDescription>
          </DialogHeader>

          {create.data ? (
            <div className="flex flex-col gap-3">
              {/* The token has no spaces, so it needs break-all to wrap. */}
              <div className="flex gap-2 rounded-lg border bg-zinc-950 p-3 text-zinc-100">
                <TerminalIcon className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                <pre className="font-mono text-xs break-all whitespace-pre-wrap">{command}</pre>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground text-xs">
                  This token won&apos;t be shown again. It works{" "}
                  {create.data.reusable ? "for any number of devices" : "once"} and expires{" "}
                  {new Date(create.data.expiresAt).toLocaleString()}.
                </p>
                {/* Brief delay so the "Copied" state is seen before the token is discarded. */}
                <CopyButton
                  value={command}
                  label="Copy command"
                  onCopy={() => setTimeout(() => changeOpen(false), 600)}
                />
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
              {canTag && (
                <div className="mt-2 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Switch id="token-reusable" checked={reusable} onCheckedChange={setReusable} />
                    <Label htmlFor="token-reusable" className="font-normal">
                      Reusable: for servers, CI and images that enroll many devices
                    </Label>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Switch
                      id="token-ephemeral"
                      checked={ephemeral}
                      onCheckedChange={setEphemeral}
                    />
                    <Label htmlFor="token-ephemeral" className="font-normal">
                      Ephemeral: devices are removed after being offline for 30 minutes
                    </Label>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Switch
                      id="token-pre-approved"
                      checked={preApproved}
                      onCheckedChange={setPreApproved}
                    />
                    <Label htmlFor="token-pre-approved" className="font-normal">
                      Pre-approved: skips device approval if the network asks for it
                    </Label>
                  </div>
                  <Label htmlFor="token-tags">Tags (optional)</Label>
                  <Input
                    id="token-tags"
                    placeholder="server, ci"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                  />
                </div>
              )}
              {create.error && (
                <p role="alert" className="text-destructive text-sm">
                  {getErrorMessage(create.error)}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {create.data ? (
              <Button type="button" variant="outline" onClick={() => changeOpen(false)}>
                Done
              </Button>
            ) : (
              <FormSubmit pending={create.isPending} onCancel={() => changeOpen(false)} />
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
