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
import { connectorMutations, connectorQueries } from "~/lib/queries";

/** "a.example.com, b.example.com" → ["a.example.com", "b.example.com"]. */
function parseDomains(text: string) {
  return text.split(/[\s,]+/).filter(Boolean);
}

/**
 * Creates an app connector, or (with `connector`) changes its domains and
 * hosts. Traffic for its domains goes through the first online host.
 */
export function ConnectorDialog({
  networkId,
  devices,
  connector,
}: {
  networkId: string;
  devices: { id: string; name: string }[];
  connector?: { id: string; name: string; domains: string[]; hosts: { id: string }[] };
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [hosts, setHosts] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () =>
      connector
        ? connectorMutations.update(connector.id, {
            domains: parseDomains(domains),
            hostDeviceIds: hosts,
          })
        : connectorMutations.create(networkId, name.trim(), parseDomains(domains), hosts),
    onSuccess: async () => {
      setOpen(false);
      toast.success(connector ? "Connector saved" : "Connector created");
      await queryClient.invalidateQueries({ queryKey: connectorQueries.all() });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return;
        setOpen(next);
        if (next) {
          setName(connector?.name ?? "");
          setDomains(connector?.domains.join(", ") ?? "");
          setHosts(connector?.hosts.map((host) => host.id) ?? []);
          save.reset();
        }
      }}
    >
      {connector ? (
        <IconAction label="Edit">
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${connector.name}`}>
              <PencilIcon />
            </Button>
          </DialogTrigger>
        </IconAction>
      ) : (
        <DialogTrigger asChild>
          <Button size="sm">
            <PlusIcon />
            Add connector
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
            <DialogTitle>
              {connector ? `Edit ${connector.name}` : "Add an app connector"}
            </DialogTitle>
            <DialogDescription>
              Traffic for these domains (and every name under them) goes through the first online
              host below. Devices look the names up there and send what they reach through it, so
              the host needs to reach those apps. Nothing else is routed.
            </DialogDescription>
          </DialogHeader>
          {!connector && (
            <div className="grid gap-2">
              <Label htmlFor="connector-name">Name</Label>
              <Input
                id="connector-name"
                placeholder="corp"
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="connector-domains">Domains</Label>
            <Input
              id="connector-domains"
              placeholder="corp.example.com, tool.example.org"
              autoComplete="off"
              value={domains}
              onChange={(event) => setDomains(event.target.value)}
            />
          </div>
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
            <Button
              type="submit"
              disabled={save.isPending || (!connector && !name.trim()) || !domains.trim()}
            >
              {save.isPending ? "Saving…" : connector ? "Save" : "Create connector"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
