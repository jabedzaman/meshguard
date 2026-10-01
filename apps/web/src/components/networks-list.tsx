"use client";

import { useEffect, useState } from "react";
import type { Network } from "@mesh/types";
import { api } from "~/lib/api";

export function NetworksList({ organizationId }: { organizationId: string }) {
  const [networks, setNetworks] = useState<Network[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.v1.networks.$get();
      if (cancelled) return;
      if (res.ok) setNetworks(await res.json());
      else setError(`Failed to load networks (${res.status}).`);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!networks) return <p className="text-muted-foreground text-sm">Loading networks…</p>;
  if (networks.length === 0) return <p className="text-muted-foreground text-sm">No networks yet.</p>;

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
