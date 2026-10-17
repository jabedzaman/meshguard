"use client";

import { useQuery } from "@tanstack/react-query";
import {
  GlobeIcon,
  LaptopIcon,
  ListChecksIcon,
  type LucideIcon,
  PlugIcon,
  ServerIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { getErrorMessage } from "@meshguard/api-client";
import { Avatar, AvatarFallback } from "@meshguard/ui/components/avatar";
import { Button } from "@meshguard/ui/components/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@meshguard/ui/components/chart";
import { Skeleton } from "@meshguard/ui/components/skeleton";
import { cn } from "@meshguard/ui/lib/utils";
import { CopyText } from "~/components/copy-text";
import { OnlineDot } from "~/components/online-dot";
import { useOrganization } from "~/components/providers/organization-provider";
import {
  aclQueries,
  connectorQueries,
  deviceQueries,
  memberQueries,
  networkQueries,
  serviceQueries,
} from "~/lib/queries";
import { timeAgo } from "~/lib/time";

/** The organization's network at a glance: counts on the left, devices and addressing on the right. */
export function NetworkOverview() {
  const { data: network, isPending, error } = useQuery(networkQueries.current());

  if (isPending) {
    return (
      <div role="status" aria-label="Loading network" className="grid gap-10 lg:grid-cols-[22rem_1fr]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[22rem_1fr]">
      <div className="flex flex-col gap-10">
        <Insights />
        <Team />
      </div>
      <div className="flex flex-col gap-10">
        <Charts />
        <Devices />
        <Addressing
          rows={[
            ["IPv4 range", network.ipv4Cidr],
            ["IPv6 range", network.ipv6Cidr],
            ["DNS domain", network.dnsDomain],
          ]}
        />
      </div>
    </div>
  );
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-lg font-medium">{children}</h2>
      {aside}
    </div>
  );
}

function Insights() {
  const { data: devices } = useQuery(deviceQueries.list());
  const { data: services } = useQuery(serviceQueries.list());
  const { data: connectors } = useQuery(connectorQueries.list());
  const { data: acl } = useQuery(aclQueries.get());

  const online = devices?.filter((device) => device.online).length;
  const servicesOnline = services?.filter((s) => s.hosts.some((h) => h.online)).length;
  const connectorsOnline = connectors?.filter((c) => c.hosts.some((h) => h.online)).length;

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Network Insights</SectionTitle>
      <div className="border-t pt-2">
        <Insight
          href="/devices"
          icon={LaptopIcon}
          title={devices && `${online} Active ${online === 1 ? "Device" : "Devices"}`}
          detail={devices && `${devices.length} enrolled`}
        />
        <Insight
          href="/services"
          icon={ServerIcon}
          title={services && `${services.length} ${services.length === 1 ? "Service" : "Services"}`}
          detail={services && `${servicesOnline} online • ${services.length - servicesOnline!} offline`}
        />
        <Insight
          href="/services"
          icon={GlobeIcon}
          title={
            connectors && `${connectors.length} App ${connectors.length === 1 ? "Connector" : "Connectors"}`
          }
          detail={
            connectors &&
            `${connectorsOnline} online • ${connectors.length - connectorsOnline!} offline`
          }
        />
        <Insight
          href="/access"
          icon={ListChecksIcon}
          title={acl && `${acl.rules.length} Access ${acl.rules.length === 1 ? "Rule" : "Rules"}`}
          detail={acl && (acl.defaultAction === "deny" ? "Rules only" : "Open by default")}
        />
      </div>
    </section>
  );
}

function Insight({
  href,
  icon: Icon,
  title,
  detail,
}: {
  href: string;
  icon: LucideIcon;
  title: string | undefined;
  detail: string | undefined;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-accent flex items-center gap-4 rounded-xl px-3 py-2.5 transition-colors"
    >
      <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
        <Icon className="size-5" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        {title === undefined ? (
          <>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </>
        ) : (
          <>
            <span className="font-medium">{title}</span>
            <span className="text-muted-foreground text-sm">{detail}</span>
          </>
        )}
      </span>
    </Link>
  );
}

function Team() {
  const organization = useOrganization();
  const { data: members } = useQuery(memberQueries.list(organization.id));

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Your Team</SectionTitle>
      {members === undefined ? (
        <Skeleton className="h-24" />
      ) : members.length > 1 ? (
        <div className="flex flex-col gap-4 border-t pt-4">
          <ul className="flex flex-wrap gap-2">
            {members.slice(0, 8).map((member) => (
              <li key={member.id} title={member.user.name}>
                <Avatar>
                  <AvatarFallback>{member.user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">{members.length} people in this organization.</p>
          <Button variant="secondary" size="sm" className="w-fit" asChild>
            <Link href="/members">Manage members</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">Start your Team</p>
          <p className="text-muted-foreground max-w-xs text-sm">
            You&apos;re the only person in this organization. Invite someone to share the network.
          </p>
          <Button size="sm" className="mt-2" asChild>
            <Link href="/members">Invite member</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

function Devices() {
  const { data: devices } = useQuery(deviceQueries.list());

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        aside={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/devices">View all</Link>
          </Button>
        }
      >
        Devices
      </SectionTitle>
      {devices === undefined ? (
        <Skeleton className="h-40" />
      ) : devices.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <PlugIcon className="text-muted-foreground size-6" />
          <p className="font-medium">No devices yet</p>
          <p className="text-muted-foreground text-sm">Connect a device to see it here.</p>
          <Button size="sm" className="mt-2" asChild>
            <Link href="/connect">Connect a device</Link>
          </Button>
        </div>
      ) : (
        <ul className="divide-y border-y">
          {devices.slice(0, 8).map((device) => (
            <li key={device.id} className="flex items-center gap-3 py-3">
              <OnlineDot online={device.online} />
              <span className="font-medium">{device.name}</span>
              <span
                className={cn(
                  "ml-auto text-sm",
                  device.online ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                )}
              >
                {device.online
                  ? "online"
                  : device.lastSeenAt
                    ? `last seen ${timeAgo(device.lastSeenAt)}`
                    : "never connected"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Addressing({ rows }: { rows: [string, string][] }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Addressing</SectionTitle>
      <dl className="divide-y border-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-3">
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="text-sm">
              <CopyText value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const RANGES = [90, 30, 7] as const;

const growthConfig = {
  devices: { label: "Devices", color: "var(--chart-1)" },
} satisfies ChartConfig;

const seenConfig = {
  seen: { label: "Last seen", color: "var(--chart-2)" },
} satisfies ChartConfig;

const DAY = 24 * 3600 * 1000;

/** Enrolled devices over time, and when each device was last seen, from what the API already knows. */
function Charts() {
  const { data: devices } = useQuery(deviceQueries.list());
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);

  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const days = Array.from({ length: range }, (_, i) => startOfToday - (range - 1 - i) * DAY);
  const data = days.map((day) => ({
    label: new Date(day).toLocaleDateString("en", { month: "short", day: "numeric" }),
    devices: devices?.filter((d) => new Date(d.createdAt).getTime() < day + DAY).length ?? 0,
    seen:
      devices?.filter((d) => {
        if (!d.lastSeenAt) return false;
        const t = new Date(d.lastSeenAt).getTime();
        return t >= day && t < day + DAY;
      }).length ?? 0,
  }));

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        aside={
          <div className="bg-muted flex rounded-lg p-0.5 text-sm" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={cn(
                  "text-muted-foreground rounded-md px-2.5 py-1",
                  range === r && "bg-background text-foreground shadow-sm",
                )}
              >
                {r} days
              </button>
            ))}
          </div>
        }
      >
        Network Growth
      </SectionTitle>
      {devices === undefined ? (
        <Skeleton className="h-56" />
      ) : (
        <div className="grid gap-8 rounded-xl border p-4 sm:grid-cols-2">
          <ChartBlock title="Devices enrolled">
            <ChartContainer config={growthConfig} className="aspect-auto h-44 w-full">
              <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="fill-devices" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-devices)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--color-devices)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} />
                <YAxis width={24} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="devices"
                  type="monotone"
                  stroke="var(--color-devices)"
                  fill="url(#fill-devices)"
                />
              </AreaChart>
            </ChartContainer>
          </ChartBlock>
          <ChartBlock title="Devices last seen">
            <ChartContainer config={seenConfig} className="aspect-auto h-44 w-full">
              <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} />
                <YAxis width={24} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="seen" fill="var(--color-seen)" radius={3} />
              </BarChart>
            </ChartContainer>
          </ChartBlock>
        </div>
      )}
    </section>
  );
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-muted-foreground text-sm">{title}</h3>
      {children}
    </div>
  );
}
