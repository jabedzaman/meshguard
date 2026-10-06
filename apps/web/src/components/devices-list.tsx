"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getErrorMessage } from "@meshguard/api-client";
import { Button } from "@meshguard/ui/components/button";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { useCurrentUser, usePermission } from "~/components/providers/organization-provider";
import { RenameDeviceDialog } from "~/components/rename-device-dialog";
import { useDeviceEvents } from "~/hooks/use-device-events";
import { deviceMutations, deviceQueries } from "~/lib/queries";

const PLATFORM_LABELS = { darwin: "macOS", linux: "Linux", windows: "Windows" } as const;

/** The API decides `online` (see PresenceStore in server-core). */
function presence(device: { online: boolean; lastSeenAt: string | null }) {
  if (device.online) return { online: true, label: "online" };
  if (!device.lastSeenAt) return { online: false, label: "never connected" };
  return { online: false, label: `last seen ${new Date(device.lastSeenAt).toLocaleString()}` };
}

export function DevicesList({ networkId }: { networkId: string }) {
  const { data: devices, isPending, error } = useQuery(deviceQueries.list(networkId));
  const user = useCurrentUser();
  // Owners and admins manage every device; everyone manages their own.
  const canRenameAny = usePermission({ device: ["update"] });
  const canRemoveAny = usePermission({ device: ["delete"] });
  const [onlyMine, setOnlyMine] = useState(false);
  const queryClient = useQueryClient();
  // Devices join and drop from the command line; the API pushes the changes.
  useDeviceEvents(networkId);

  if (isPending) return <p className="text-muted-foreground text-sm">Loading devices…</p>;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;
  if (devices.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No devices yet. Use Add device to get a command for each machine.
      </p>
    );
  }

  const mine = (device: (typeof devices)[number]) => device.owner?.id === user.id;
  const shown = onlyMine ? devices.filter(mine) : devices;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1" role="group" aria-label="Show devices">
        {[
          { label: "All", value: false },
          { label: "Mine", value: true },
        ].map((filter) => (
          <Button
            key={filter.label}
            variant={onlyMine === filter.value ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={onlyMine === filter.value}
            onClick={() => setOnlyMine(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          None of the devices here are yours. Use Add device to enroll one.
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {shown.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <div className="grid">
                <span className="flex items-center gap-2 font-medium">
                  <span
                    aria-hidden
                    className={`size-2 rounded-full ${presence(device).online ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                  />
                  {device.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {PLATFORM_LABELS[device.platform]} · {presence(device).label}
                  {device.owner && ` · ${mine(device) ? "yours" : device.owner.name}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground grid text-right font-mono text-xs">
                  <span>{device.meshIpv4}</span>
                  <span>{device.meshIpv6}</span>
                </span>
                {(canRenameAny || mine(device)) && <RenameDeviceDialog device={device} />}
                {(canRemoveAny || mine(device)) && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm" aria-label={`Remove ${device.name}`}>
                        Remove
                      </Button>
                    }
                    title={`Remove ${device.name}?`}
                    description={`It leaves the network and peers stop reaching ${device.name}.internal. To bring it back, run meshguard logout --force on it, then enroll it again.`}
                    confirmLabel="Remove device"
                    onConfirm={async () => {
                      await deviceMutations.remove(device.id);
                      await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
