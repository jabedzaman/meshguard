"use client";

import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "@mesh/api-client";
import { networkQueries } from "~/lib/queries";

export function NetworksList({ organizationId }: { organizationId: string }) {
  const { data: networks, isPending, error } = useQuery(networkQueries.list(organizationId));

  if (isPending) return <p className="text-muted-foreground text-sm">Loading networks…</p>;
  if (error)
    return (
      <p className="text-destructive text-sm">Failed to load networks: {getErrorMessage(error)}</p>
    );
  if (networks.length === 0)
    return <p className="text-muted-foreground text-sm">No networks yet.</p>;

  return (
    <ul className="divide-border divide-y rounded-md border">
      {networks.map((n) => (
        <li key={n.id} className="flex items-center justify-between p-3 text-sm">
          <span className="font-medium">{n.name}</span>
          <span className="text-muted-foreground font-mono">{n.ipv4Cidr}</span>
        </li>
      ))}
    </ul>
  );
}
