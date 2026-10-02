"use client";

import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "@meshguard/api-client";
import { useDeviceEvents } from "~/hooks/use-device-events";
import { deviceQueries } from "~/lib/queries";

const PLATFORM_LABELS = { darwin: "macOS", linux: "Linux", windows: "Windows" } as const;

/** The API decides `online` (see PresenceStore in server-core). */
function presence(device: { online: boolean; lastSeenAt: string | null }) {
  if (device.online) return { online: true, label: "online" };
  if (!device.lastSeenAt) return { online: false, label: "never connected" };
  return { online: false, label: `last seen ${new Date(device.lastSeenAt).toLocaleString()}` };
}

export function DevicesList({ networkId }: { networkId: string }) {
  const { data: devices, isPending, error } = useQuery(deviceQueries.list(networkId));
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

  return (
    <ul className="divide-border divide-y rounded-md border">
      {devices.map((device) => (
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
            </span>
          </div>
          <span className="text-muted-foreground grid text-right font-mono text-xs">
            <span>{device.meshIpv4}</span>
            <span>{device.meshIpv6}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
