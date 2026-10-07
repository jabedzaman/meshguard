"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TagIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Input } from "@meshguard/ui/components/input";
import { Label } from "@meshguard/ui/components/label";
import { IconAction } from "~/components/icon-action";
import { aclQueries, deviceMutations, deviceQueries } from "~/lib/queries";

/** "server, db" → ["server", "db"]; accepts an optional "tag:" prefix. */
function parseTags(text: string) {
  return text
    .split(/[\s,]+/)
    .map((tag) => tag.trim().toLowerCase().replace(/^tag:/, ""))
    .filter(Boolean);
}

/** Owners and admins set a device's tags, which access rules can name. */
export function DeviceTagsDialog({
  device,
}: {
  device: { id: string; name: string; tags: string[] };
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: () => deviceMutations.setTags(device.id, parseTags(text)),
    onSuccess: async () => {
      setOpen(false);
      toast.success("Tags saved");
      await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
      await queryClient.invalidateQueries({ queryKey: aclQueries.all() });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return;
        setOpen(next);
        if (next) {
          setText(device.tags.join(", "));
          save.reset();
        }
      }}
    >
      <IconAction label="Tags">
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Tags of ${device.name}`}>
            <TagIcon />
          </Button>
        </DialogTrigger>
      </IconAction>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Tags of {device.name}</DialogTitle>
            <DialogDescription>
              Access rules can name a tag instead of each device (tag:server). Changes apply to
              every device&apos;s rules within a second or two.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="device-tags">Tags</Label>
            <Input
              id="device-tags"
              placeholder="server, db"
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          {save.error && (
            <p role="alert" className="text-destructive text-sm">
              {getErrorMessage(save.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save tags"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
