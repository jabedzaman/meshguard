"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RouteIcon } from "lucide-react";
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
import { IconAction } from "~/components/icon-action";
import { deviceMutations, deviceQueries } from "~/lib/queries";

/**
 * Owners and admins approve the subnets a device offers to route. Nothing
 * reaches peers until a route is approved.
 */
export function DeviceRoutesDialog({
  device,
}: {
  device: { id: string; name: string; routes: { prefix: string; approved: boolean }[] };
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [approved, setApproved] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () => deviceMutations.setRoutes(device.id, approved),
    onSuccess: async () => {
      setOpen(false);
      toast.success("Routes saved");
      await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
    },
  });
  const pending = device.routes.filter((route) => !route.approved).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return;
        setOpen(next);
        if (next) {
          setApproved(device.routes.filter((route) => route.approved).map((route) => route.prefix));
          save.reset();
        }
      }}
    >
      <IconAction label={pending ? `Routes (${pending} to approve)` : "Routes"}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Routes of ${device.name}`}>
            <RouteIcon className={pending ? "text-amber-600 dark:text-amber-400" : undefined} />
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
            <DialogTitle>Routes of {device.name}</DialogTitle>
            <DialogDescription>
              Subnets this device offers to route, set with{" "}
              <code>meshguard set --advertise-routes</code>. Devices that accept routes send traffic
              for an approved subnet through {device.name}.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2">
            {device.routes.map((route) => (
              <li key={route.prefix}>
                <label className="flex items-center gap-2 font-mono text-sm">
                  <input
                    type="checkbox"
                    checked={approved.includes(route.prefix)}
                    onChange={(event) =>
                      setApproved((current) =>
                        event.target.checked
                          ? [...current, route.prefix]
                          : current.filter((prefix) => prefix !== route.prefix),
                      )
                    }
                  />
                  {route.prefix}
                </label>
              </li>
            ))}
          </ul>
          {save.error && (
            <p role="alert" className="text-destructive text-sm">
              {getErrorMessage(save.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save routes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
