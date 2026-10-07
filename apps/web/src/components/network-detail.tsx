"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  ArrowLeftIcon,
  LaptopIcon,
  ListChecksIcon,
  type LucideIcon,
  ShieldIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getErrorMessage } from "@meshguard/api-client";
import { Badge } from "@meshguard/ui/components/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meshguard/ui/components/card";
import { Skeleton } from "@meshguard/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@meshguard/ui/components/tabs";
import { AccessRules } from "~/components/access-rules";
import { AddDeviceDialog } from "~/components/add-device-dialog";
import { DevicesList } from "~/components/devices-list";
import { EnrollmentTokensList } from "~/components/enrollment-tokens-list";
import { aclQueries, deviceQueries, networkQueries } from "~/lib/queries";

const TABS = ["devices", "access"] as const;
type Tab = (typeof TABS)[number];

export function NetworkDetail({ networkId }: { networkId: string }) {
  const { data: network, isPending, error } = useQuery(networkQueries.detail(networkId));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The tab lives in the URL so links and reloads land on it.
  const param = searchParams.get("tab");
  const tab: Tab = TABS.includes(param as Tab) ? (param as Tab) : "devices";

  if (isPending) {
    return (
      <div role="status" aria-label="Loading network" className="flex flex-col gap-6">
        <Skeleton className="h-16 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          >
            <ArrowLeftIcon className="size-3" />
            Networks
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{network.name}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="font-mono">
              {network.ipv4Cidr}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {network.ipv6Cidr}
            </Badge>
            <Badge
              variant="outline"
              className="font-mono"
              title="Devices resolve as <name>.<domain>"
            >
              {network.dnsDomain}
            </Badge>
          </div>
        </div>
        <AddDeviceDialog networkId={network.id} />
      </div>

      <NetworkStats networkId={network.id} />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const params = new URLSearchParams(searchParams);
          if (value === "devices") params.delete("tab");
          else params.set("tab", value);
          const query = params.toString();
          router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        }}
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="devices">
            <LaptopIcon />
            Devices
          </TabsTrigger>
          <TabsTrigger value="access">
            <ShieldIcon />
            Access
          </TabsTrigger>
        </TabsList>
        <TabsContent value="devices" className="flex flex-col gap-8">
          <DevicesList networkId={network.id} dnsDomain={network.dnsDomain} />
          <section className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-sm font-medium">Active enrollment tokens</h2>
            <EnrollmentTokensList networkId={network.id} />
          </section>
        </TabsContent>
        <TabsContent value="access">
          <AccessRules networkId={network.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NetworkStats({ networkId }: { networkId: string }) {
  const { data: devices } = useQuery(deviceQueries.list(networkId));
  const { data: acl } = useQuery(aclQueries.get(networkId));
  const online = devices?.filter((device) => device.online).length;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat icon={LaptopIcon} label="Devices" value={devices?.length} />
      <Stat icon={ActivityIcon} label="Online" value={online} highlight={!!online} />
      <Stat icon={ListChecksIcon} label="Access rules" value={acl?.rules.length} />
      <Stat
        icon={ShieldIcon}
        label="Policy"
        value={acl && (acl.defaultAction === "deny" ? "Rules only" : "Open")}
      />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode | undefined;
  highlight?: boolean;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <Icon className="text-muted-foreground size-4" />
        </CardAction>
        <CardTitle
          className={`text-2xl tabular-nums ${highlight ? "text-emerald-600 dark:text-emerald-400" : ""}`}
        >
          {value === undefined ? <Skeleton className="h-7 w-12" /> : value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
