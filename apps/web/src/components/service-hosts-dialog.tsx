"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon } from "lucide-react";
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
import { aclQueries, serviceMutations, serviceQueries } from "~/lib/queries";

type DeviceOption = { id: string; name: string };

/**
 * Creates a service, or (with `service`) changes the devices that host it.
 * Traffic to a service's address goes to its first online host.
 */
export function ServiceDialog({
  networkId,
  devices,
  service,
}: {
  networkId: string;
  devices: DeviceOption[];
  service?: { id: string; name: string; hosts: { id: string }[] };
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () =>
      service
        ? serviceMutations.setHosts(service.id, hosts)
        : serviceMutations.create(networkId, name.trim(), hosts),
    onSuccess: async () => {
      setOpen(false);
      toast.success(service ? "Hosts saved" : "Service created");
      await queryClient.invalidateQueries({ queryKey: serviceQueries.all() });
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
          setName(service?.name ?? "");
          setHosts(service?.hosts.map((host) => host.id) ?? []);
          save.reset();
        }
      }}
    >
      {service ? (
        <IconAction label="Hosts">
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Hosts of ${service.name}`}>
              <PencilIcon />
            </Button>
          </DialogTrigger>
        </IconAction>
      ) : (
        <DialogTrigger asChild>
          <Button size="sm">
            <PlusIcon />
            Add service
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{service ? `Hosts of ${service.name}` : "Add a service"}</DialogTitle>
            <DialogDescription>
              A service is a name and an address in the network. Anything connecting to it reaches
              the first online host below; if that device goes offline, the next one takes over.
            </DialogDescription>
          </DialogHeader>
          {!service && (
            <div className="grid gap-2">
              <Label htmlFor="service-name">Name</Label>
              <Input
                id="service-name"
                placeholder="web"
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Hosts</legend>
            {devices.length === 0 && (
              <p className="text-muted-foreground text-sm">No devices in this network yet.</p>
            )}
            {devices.map((device) => (
              <label key={device.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hosts.includes(device.id)}
                  onChange={(event) =>
                    setHosts((current) =>
                      event.target.checked
                        ? [...current, device.id]
                        : current.filter((id) => id !== device.id),
                    )
                  }
                />
                {device.name}
              </label>
            ))}
          </fieldset>
          {save.error && (
            <p role="alert" className="text-destructive text-sm">
              {getErrorMessage(save.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || (!service && !name.trim())}>
              {save.isPending ? "Saving…" : service ? "Save hosts" : "Create service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
