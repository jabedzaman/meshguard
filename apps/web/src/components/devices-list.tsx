"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getErrorMessage } from "@mesh/api-client";
import { deviceQueries, enrollmentTokenQueries } from "~/lib/queries";

const PLATFORM_LABELS = { darwin: "macOS", linux: "Linux", windows: "Windows" } as const;

/** Agents sync every 10s; matches ONLINE_WINDOW_MS on the server. */
const ONLINE_WINDOW_MS = 30_000;

function presence(lastSeenAt: string | null) {
  if (!lastSeenAt) return { online: false, label: "never connected" };
  const ago = Date.now() - new Date(lastSeenAt).getTime();
  if (ago < ONLINE_WINDOW_MS) return { online: true, label: "online" };
  return { online: false, label: `last seen ${new Date(lastSeenAt).toLocaleString()}` };
}

export function DevicesList({ networkId }: { networkId: string }) {
  const queryClient = useQueryClient();
  const {
    data: devices,
    isPending,
    error,
  } = useQuery({
    ...deviceQueries.list(networkId),
    // Devices join from the command line; pick them up without a reload.
    refetchInterval: 5_000,
  });

  // A new device used up a token; refresh the active tokens list too.
  const deviceCount = devices?.length;
  useEffect(() => {
    if (deviceCount === undefined) return;
    void queryClient.invalidateQueries({
      queryKey: enrollmentTokenQueries.active(networkId).queryKey,
    });
  }, [deviceCount, networkId, queryClient]);

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
                className={`size-2 rounded-full ${presence(device.lastSeenAt).online ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
              />
              {device.name}
            </span>
            <span className="text-muted-foreground text-xs">
              {PLATFORM_LABELS[device.platform]} · {presence(device.lastSeenAt).label}
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
