"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  GlobeIcon,
  InfinityIcon,
  LaptopIcon,
  MonitorIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";
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
import { Input } from "@meshguard/ui/components/input";
import { ToggleGroup, ToggleGroupItem } from "@meshguard/ui/components/toggle-group";
import { CopyText } from "~/components/copy-text";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { groupRoutes } from "~/lib/routes";
import { DeviceRoutesDialog } from "~/components/device-routes-dialog";
import { DeviceTagsDialog } from "~/components/device-tags-dialog";
import { ListSkeleton } from "~/components/list-skeleton";
import { OnlineDot } from "~/components/online-dot";
import { useCurrentUser, usePermission } from "~/components/providers/organization-provider";
import { RenameDeviceDialog } from "~/components/rename-device-dialog";
import { useDeviceEvents } from "~/hooks/use-device-events";
import { useFlash } from "~/hooks/use-flash";
import { deviceMutations, deviceQueries, networkQueries } from "~/lib/queries";
import { timeAgo } from "~/lib/time";

const PLATFORMS = {
  darwin: { label: "macOS", icon: LaptopIcon },
  linux: { label: "Linux", icon: ServerIcon },
  windows: { label: "Windows", icon: MonitorIcon },
} as const;

/** The API decides `online` (see PresenceStore in server-core). */
function presence(device: {
  online: boolean;
  lastSeenAt: string | null;
  approved: boolean;
  keyExpired: boolean;
}) {
  if (!device.approved) return { online: false, label: "waiting for approval" };
  if (device.keyExpired) return { online: false, label: "key expired" };
  if (device.online) return { online: true, label: "online" };
  if (!device.lastSeenAt) return { online: false, label: "never connected" };
  return { online: false, label: `last seen ${timeAgo(device.lastSeenAt)}` };
}

type Device = {
  id: string;
  name: string;
  online: boolean;
  tags: string[];
  funnel: boolean;
  approved: boolean;
  keyExpired: boolean;
  keyExpiresAt: string | null;
  routes: { prefix: string; approved: boolean }[];
};
const deviceId = (device: Device) => device.id;
// What a viewer would notice changing: presence, name and tags.
const deviceSignature = (device: Device) =>
  `${device.online}|${device.approved}|${device.keyExpired}|${device.name}|${device.funnel}|${device.tags.join(",")}|${device.routes
    .map((route) => route.prefix + route.approved)
    .join(",")}`;

export function DevicesList() {
  const { data: network, isPending: networkPending } = useQuery(networkQueries.current());
  const { data: devices, isPending, error } = useQuery(deviceQueries.list());
  const dnsDomain = network?.dnsDomain ?? "";
  const user = useCurrentUser();
  // Owners and admins manage every device; everyone manages their own.
  const canRenameAny = usePermission({ device: ["update"] });
  const canRemoveAny = usePermission({ device: ["delete"] });
  const [onlyMine, setOnlyMine] = useState(false);
  const [status, setStatus] = useState<"all" | "online" | "offline">("all");
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();
  // Devices join and drop from the command line; the API pushes the changes.
  useDeviceEvents();
  const listRef = useFlash(devices, deviceId, deviceSignature);

  if (isPending || networkPending) return <ListSkeleton label="Loading devices" />;
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
  const needle = query.trim().toLowerCase();
  const shown = devices.filter(
    (device) =>
      (!onlyMine || mine(device)) &&
      (status === "all" || device.online === (status === "online")) &&
      (!needle ||
        [device.name, device.meshIpv4, device.meshIpv6, ...device.tags.map((t) => `tag:${t}`)].some(
          (value) => value?.toLowerCase().includes(needle),
        )),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, IP or tag"
          aria-label="Search devices"
          className="h-8 w-56"
        />
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
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Filter by status"
          value={status}
          onValueChange={(value) => value && setStatus(value as typeof status)}
        >
          <ToggleGroupItem value="all" className="px-3">
            Any status
          </ToggleGroupItem>
          <ToggleGroupItem value="online" className="px-3">
            Online
          </ToggleGroupItem>
          <ToggleGroupItem value="offline" className="px-3">
            Offline
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">No devices match these filters.</p>
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
                      {!device.approved && (
                        <Badge
                          variant="outline"
                          className="font-normal text-amber-700 dark:text-amber-400"
                        >
                          pending approval
                        </Badge>
                      )}
                      {device.keyExpired && (
                        <Badge variant="outline" className="text-destructive font-normal">
                          key expired
                        </Badge>
                      )}
                      {device.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-mono font-normal">
                          tag:{tag}
                        </Badge>
                      ))}
                      {device.funnel && (
                        <Badge
                          variant="outline"
                          className="gap-1 font-normal text-amber-700 dark:text-amber-400"
                          title={`Reachable from the internet at https://${device.name}.${dnsDomain}`}
                        >
                          <GlobeIcon className="size-3" />
                          public
                        </Badge>
                      )}
                      {groupRoutes(device.routes).map((route) => (
                        <Badge
                          key={route.label}
                          variant={route.approved ? "secondary" : "outline"}
                          className="font-mono font-normal"
                          title={route.approved ? "Route approved" : "Route waiting for approval"}
                        >
                          {route.label}
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
                      {device.keyExpiresAt && !device.keyExpired && (
                        <span title={new Date(device.keyExpiresAt).toLocaleString()}>
                          {" "}
                          · key ends {timeAgo(device.keyExpiresAt)}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground grid text-right font-mono text-xs">
                    {device.meshIpv4 && (
                      <CopyText value={device.meshIpv4} className="text-foreground" />
                    )}
                    {device.meshIpv6 && <CopyText value={device.meshIpv6} />}
                  </span>
                  <div className="flex items-center">
                    {canRenameAny && !device.approved && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-emerald-600 dark:text-emerald-400"
                            aria-label={`Approve ${device.name}`}
                          >
                            <CheckIcon />
                          </Button>
                        }
                        triggerTooltip="Approve"
                        title={`Approve ${device.name}?`}
                        description="It joins the network at its next sync and peers can reach it."
                        onConfirm={async () => {
                          await deviceMutations.approve(device.id);
                          toast.success("Device approved");
                          await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
                        }}
                        variant="default"
                      />
                    )}
                    {canRenameAny && device.keyExpiresAt && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className={device.keyExpired ? "text-destructive" : undefined}
                            aria-label={`Renew key of ${device.name}`}
                          >
                            <RefreshCwIcon />
                          </Button>
                        }
                        triggerTooltip="Renew key"
                        title={`Renew the key of ${device.name}?`}
                        description="Starts a new key period from now. An expired device is accepted again at its next sync."
                        onConfirm={async () => {
                          await deviceMutations.setKey(device.id, "renew");
                          toast.success("Key renewed");
                          await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
                        }}
                        variant="default"
                      />
                    )}
                    {canRenameAny && device.keyExpiresAt && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Disable key expiry of ${device.name}`}
                          >
                            <InfinityIcon />
                          </Button>
                        }
                        triggerTooltip="Never expire"
                        title={`Stop ${device.name}'s key expiring?`}
                        description="Its key stays valid until you remove the device. Use it for servers that no one signs in to again."
                        onConfirm={async () => {
                          await deviceMutations.setKey(device.id, "never");
                          toast.success("Key no longer expires");
                          await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
                        }}
                        variant="default"
                      />
                    )}
                    {canRenameAny && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className={
                              device.funnel ? "text-amber-600 dark:text-amber-400" : undefined
                            }
                            aria-label={`Public access of ${device.name}`}
                          >
                            <GlobeIcon />
                          </Button>
                        }
                        triggerTooltip={device.funnel ? "Public: turn off" : "Make public"}
                        title={
                          device.funnel
                            ? `Stop public access to ${device.name}?`
                            : `Let the internet reach ${device.name}?`
                        }
                        description={
                          device.funnel
                            ? `https://${device.name}.${dnsDomain} stops answering from outside the network.`
                            : `Anyone on the internet can then open https://${device.name}.${dnsDomain}, through the relay. They reach only the local port someone chooses on the device with meshguard funnel <port>; nothing is shared until then.`
                        }
                        onConfirm={async () => {
                          await deviceMutations.setFunnel(device.id, !device.funnel);
                          toast.success(device.funnel ? "Public access off" : "Public access on");
                          await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
                        }}
                      />
                    )}
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
