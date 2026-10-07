"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LaptopIcon, MonitorIcon, ServerIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@meshguard/api-client";
import { Badge } from "@meshguard/ui/components/badge";
import { Button } from "@meshguard/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@meshguard/ui/components/empty";
import { ToggleGroup, ToggleGroupItem } from "@meshguard/ui/components/toggle-group";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { DeviceRoutesDialog } from "~/components/device-routes-dialog";
import { DeviceTagsDialog } from "~/components/device-tags-dialog";
import { ListSkeleton } from "~/components/list-skeleton";
import { OnlineDot } from "~/components/online-dot";
import { useCurrentUser, usePermission } from "~/components/providers/organization-provider";
import { RenameDeviceDialog } from "~/components/rename-device-dialog";
import { useDeviceEvents } from "~/hooks/use-device-events";
import { useFlash } from "~/hooks/use-flash";
import { deviceMutations, deviceQueries } from "~/lib/queries";
import { timeAgo } from "~/lib/time";

const PLATFORMS = {
  darwin: { label: "macOS", icon: LaptopIcon },
  linux: { label: "Linux", icon: ServerIcon },
  windows: { label: "Windows", icon: MonitorIcon },
} as const;

/** The API decides `online` (see PresenceStore in server-core). */
function presence(device: { online: boolean; lastSeenAt: string | null }) {
  if (device.online) return { online: true, label: "online" };
  if (!device.lastSeenAt) return { online: false, label: "never connected" };
  return { online: false, label: `last seen ${timeAgo(device.lastSeenAt)}` };
}

type Device = {
  id: string;
  name: string;
  online: boolean;
  tags: string[];
  routes: { prefix: string; approved: boolean }[];
};
const deviceId = (device: Device) => device.id;
// What a viewer would notice changing: presence, name and tags.
const deviceSignature = (device: Device) =>
  `${device.online}|${device.name}|${device.tags.join(",")}|${device.routes
    .map((route) => route.prefix + route.approved)
    .join(",")}`;

export function DevicesList({ networkId, dnsDomain }: { networkId: string; dnsDomain: string }) {
  const { data: devices, isPending, error } = useQuery(deviceQueries.list(networkId));
  const user = useCurrentUser();
  // Owners and admins manage every device; everyone manages their own.
  const canRenameAny = usePermission({ device: ["update"] });
  const canRemoveAny = usePermission({ device: ["delete"] });
  const [onlyMine, setOnlyMine] = useState(false);
  const queryClient = useQueryClient();
  // Devices join and drop from the command line; the API pushes the changes.
  useDeviceEvents(networkId);
  const listRef = useFlash(devices, deviceId, deviceSignature);

  if (isPending) return <ListSkeleton label="Loading devices" />;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;
  if (devices.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LaptopIcon />
          </EmptyMedia>
          <EmptyTitle>No devices yet.</EmptyTitle>
          <EmptyDescription>
            Use Add device to get a command for each machine. It shows up here the moment it joins.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const mine = (device: (typeof devices)[number]) => device.owner?.id === user.id;
  const shown = onlyMine ? devices.filter(mine) : devices;

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Show devices"
        value={onlyMine ? "mine" : "all"}
        // Ignore deselecting: one filter is always on.
        onValueChange={(value) => value && setOnlyMine(value === "mine")}
      >
        <ToggleGroupItem value="all" className="px-3">
          All
        </ToggleGroupItem>
        <ToggleGroupItem value="mine" className="px-3">
          Mine
        </ToggleGroupItem>
      </ToggleGroup>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          None of the devices here are yours. Use Add device to enroll one.
        </p>
      ) : (
        <ul ref={listRef} className="divide-border bg-card divide-y rounded-xl border shadow-sm">
          {shown.map((device) => {
            const platform = PLATFORMS[device.platform];
            const status = presence(device);
            return (
              <li
                key={device.id}
                data-flash-id={device.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 text-sm first:rounded-t-xl last:rounded-b-xl"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="bg-muted relative flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <platform.icon className="text-muted-foreground size-4" />
                    <OnlineDot
                      online={status.online}
                      className="ring-card absolute -right-0.5 -bottom-0.5 rounded-full ring-2"
                    />
                  </span>
                  <div className="grid min-w-0 gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {device.name}
                      {device.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-mono font-normal">
                          tag:{tag}
                        </Badge>
                      ))}
                      {device.routes.map((route) => (
                        <Badge
                          key={route.prefix}
                          variant={route.approved ? "secondary" : "outline"}
                          className="font-mono font-normal"
                          title={route.approved ? "Route approved" : "Route waiting for approval"}
                        >
                          {route.prefix}
                          {!route.approved && " · pending"}
                        </Badge>
                      ))}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {platform.label} ·{" "}
                      <span
                        className={
                          status.online
                            ? "text-emerald-600 dark:text-emerald-400 font-medium"
                            : undefined
                        }
                      >
                        {status.label}
                      </span>
                      {device.owner && ` · ${mine(device) ? "yours" : device.owner.name}`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground grid text-right font-mono text-xs">
                    <span className="text-foreground">{device.meshIpv4}</span>
                    <span>{device.meshIpv6}</span>
                  </span>
                  <div className="flex items-center">
                    {canRenameAny && device.routes.length > 0 && (
                      <DeviceRoutesDialog device={device} />
                    )}
                    {canRenameAny && <DeviceTagsDialog device={device} />}
                    {(canRenameAny || mine(device)) && (
                      <RenameDeviceDialog device={device} dnsDomain={dnsDomain} />
                    )}
                    {(canRemoveAny || mine(device)) && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-destructive"
                            aria-label={`Remove ${device.name}`}
                          >
                            <Trash2Icon />
                          </Button>
                        }
                        triggerTooltip="Remove"
                        title={`Remove ${device.name}?`}
                        description={`It leaves the network and peers stop reaching ${device.name}.${dnsDomain}. To bring it back, run meshguard logout --force on it, then enroll it again.`}
                        confirmLabel="Remove device"
                        onConfirm={async () => {
                          await deviceMutations.remove(device.id);
                          toast.success("Device removed");
                          await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
                        }}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
