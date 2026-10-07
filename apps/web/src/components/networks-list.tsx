"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, NetworkIcon } from "lucide-react";
import Link from "next/link";
import { getErrorMessage } from "@meshguard/api-client";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@meshguard/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@meshguard/ui/components/empty";
import { Skeleton } from "@meshguard/ui/components/skeleton";
import { OnlineDot } from "~/components/online-dot";
import { useOrganization } from "~/components/providers/organization-provider";
import { deviceQueries, networkQueries } from "~/lib/queries";

export function NetworksList() {
  const organization = useOrganization();
  const { data: networks, isPending, error } = useQuery(networkQueries.list(organization.id));

  if (isPending) {
    return (
      <div role="status" aria-label="Loading networks" className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }
  if (error)
    return (
      <p className="text-destructive text-sm">Failed to load networks: {getErrorMessage(error)}</p>
    );
  if (networks.length === 0)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <NetworkIcon />
          </EmptyMedia>
          <EmptyTitle>No networks yet.</EmptyTitle>
          <EmptyDescription>
            Create one, then add your machines to it with a one-time command.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {networks.map((network) => (
        <li key={network.id}>
          <NetworkCard network={network} />
        </li>
      ))}
    </ul>
  );
}

function NetworkCard({
  network,
}: {
  network: { id: string; name: string; ipv4Cidr: string; ipv6Cidr: string };
}) {
  const { data: devices } = useQuery(deviceQueries.list(network.id));
  const online = devices?.filter((device) => device.online).length ?? 0;

  return (
    <Link href={`/networks/${network.id}`} className="group block h-full">
      <Card className="group-hover:border-foreground/20 h-full gap-4 transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NetworkIcon className="text-muted-foreground size-4" />
            {network.name}
          </CardTitle>
          <CardDescription className="grid font-mono text-xs">
            <span>{network.ipv4Cidr}</span>
            <span>{network.ipv6Cidr}</span>
          </CardDescription>
          <CardAction>
            <ArrowUpRightIcon className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex-1" />
        <CardFooter className="gap-2 text-sm">
          {devices ? (
            <>
              <OnlineDot online={online > 0} />
              <span>
                <span className="font-medium">{online}</span>
                <span className="text-muted-foreground"> of {devices.length} devices online</span>
              </span>
            </>
          ) : (
            <Skeleton className="h-4 w-36" />
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}
