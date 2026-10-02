"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getErrorMessage } from "@meshguard/api-client";
import { useOrganization } from "~/components/providers/organization-provider";
import { networkQueries } from "~/lib/queries";

export function NetworksList() {
  const organization = useOrganization();
  const { data: networks, isPending, error } = useQuery(networkQueries.list(organization.id));

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
        <li key={n.id}>
          <Link
            href={`/networks/${n.id}`}
            className="hover:bg-muted/50 flex items-center justify-between p-3 text-sm"
          >
            <span className="font-medium">{n.name}</span>
            <span className="text-muted-foreground flex gap-3 font-mono text-xs">
              <span>{n.ipv4Cidr}</span>
              <span>{n.ipv6Cidr}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
