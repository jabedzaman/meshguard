"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getErrorMessage } from "@mesh/api-client";
import { AddDeviceDialog } from "~/components/add-device-dialog";
import { EnrollmentTokensList } from "~/components/enrollment-tokens-list";
import { networkQueries } from "~/lib/queries";

export function NetworkDetail({ networkId }: { networkId: string }) {
  const { data: network, isPending, error } = useQuery(networkQueries.detail(networkId));

  if (isPending) return <p className="text-muted-foreground text-sm">Loading network…</p>;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <Link href="/" className="text-muted-foreground text-xs hover:underline">
            ← Networks
          </Link>
          <h2 className="text-lg font-semibold">{network.name}</h2>
          <p className="text-muted-foreground font-mono text-xs">
            {network.ipv4Cidr} · {network.ipv6Cidr}
          </p>
        </div>
        <AddDeviceDialog networkId={network.id} />
      </div>
      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Devices</h3>
        <p className="text-muted-foreground text-sm">
          No devices yet. Use Add device to get a command for each machine.
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Active enrollment tokens</h3>
        <EnrollmentTokensList networkId={network.id} />
      </section>
    </div>
  );
}
