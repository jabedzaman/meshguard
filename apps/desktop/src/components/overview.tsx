import { useState } from "react";
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  Loader2,
  MonitorSmartphoneIcon,
  RouteIcon,
  ServerIcon,
  ZapIcon,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@meshguard/ui/components/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@meshguard/ui/components/chart";
import { Separator } from "@meshguard/ui/components/separator";
import { Switch } from "@meshguard/ui/components/switch";
import { OnlineDot } from "~/components/online-dot";
import { agent, errorMessage, type Status } from "~/lib/agent";
import { formatBytes, formatRate, useTraffic } from "~/lib/traffic";

const stateLabel: Record<Status["state"], string> = {
  connected: "Connected",
  enrolled: "Connecting…",
  down: "Disconnected",
  not_enrolled: "Not signed in",
};

const trafficConfig = {
  rx: { label: "Download", color: "var(--chart-1)" },
  tx: { label: "Upload", color: "var(--chart-2)" },
} satisfies ChartConfig;

const pathConfig = {
  direct: { label: "Direct", color: "var(--chart-1)" },
  relay: { label: "Relay", color: "var(--chart-2)" },
  idle: { label: "Idle", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

const perPeerConfig = {
  rx: trafficConfig.rx,
  tx: trafficConfig.tx,
} satisfies ChartConfig;

export function Overview({ status }: { status: Status }) {
  const [busy, setBusy] = useState(false);
  const on = status.state === "connected" || status.state === "enrolled";
  const peers = status.peers ?? [];
  const traffic = useTraffic(status);
  const now = traffic[traffic.length - 1];

  const direct = peers.filter((p) => !p.viaRelay && p.endpoint).length;
  const relayed = peers.filter((p) => p.viaRelay).length;
  const idle = peers.length - direct - relayed;

  async function toggle(connected: boolean) {
    setBusy(true);
    try {
      await agent.setConnected(connected);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      {/* Who and where */}
      <section className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="bg-muted relative flex size-12 shrink-0 items-center justify-center rounded-2xl">
            <MonitorSmartphoneIcon className="text-muted-foreground size-6" />
            <OnlineDot
              online={status.state === "connected"}
              className="ring-background absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2"
            />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{status.device?.name}</h1>
              <Badge variant={status.state === "connected" ? "default" : "secondary"}>
                {stateLabel[status.state]}
              </Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <span>{status.network?.name}</span>
              <span aria-hidden>·</span>
              <CopyValue value={status.device?.meshIpv4} />
            </p>
            {status.problem && <p className="text-destructive mt-1 text-xs">{status.problem}</p>}
          </div>
        </div>
        {busy ? (
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        ) : (
          <Switch checked={on} onCheckedChange={toggle} aria-label="Connect to the mesh" />
        )}
      </section>

      {/* Traffic */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <ActivityIcon className="size-4" />
            Traffic
          </h2>
          <div className="flex gap-6 text-sm">
            <Legend color="var(--chart-1)" icon={ArrowDownIcon} label="Download" value={formatRate(now.rx)} />
            <Legend color="var(--chart-2)" icon={ArrowUpIcon} label="Upload" value={formatRate(now.tx)} />
          </div>
        </div>
        <ChartContainer config={trafficConfig} className="aspect-auto h-44 w-full">
          <AreaChart data={traffic} margin={{ left: 0, right: 0, top: 8 }}>
            <defs>
              {(["rx", "tx"] as const).map((key) => (
                <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.45} />
                  <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="at" hide />
            <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatRate(v)} tickCount={3} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, items) => {
                    const at = (items[0] as { payload?: { at?: number } } | undefined)?.payload?.at;
                    return at ? new Date(at).toLocaleTimeString() : null;
                  }}
                  valueFormatter={formatRate}
                />
              }
            />
            <Area dataKey="rx" type="monotone" stroke="var(--color-rx)" fill="url(#fill-rx)" strokeWidth={2} isAnimationActive={false} />
            <Area dataKey="tx" type="monotone" stroke="var(--color-tx)" fill="url(#fill-tx)" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ChartContainer>
      </section>

      <Separator />

      {/* Paths and per-device traffic */}
      <section className="grid gap-8 md:grid-cols-[14rem_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <RouteIcon className="size-4" />
            Connections
          </h2>
          {peers.length === 0 ? (
            <p className="text-muted-foreground text-sm">No other devices yet.</p>
          ) : (
            <>
              <div className="relative">
                <ChartContainer config={pathConfig} className="mx-auto aspect-square h-36">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={[
                        { path: "Direct", count: direct, fill: "var(--color-direct)" },
                        { path: "Relay", count: relayed, fill: "var(--color-relay)" },
                        { path: "Idle", count: idle, fill: "var(--color-idle)" },
                      ].filter((d) => d.count > 0)}
                      dataKey="count"
                      nameKey="path"
                      innerRadius={44}
                      outerRadius={64}
                      paddingAngle={2}
                      strokeWidth={0}
                      isAnimationActive={false}
                    >
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-semibold">{peers.length}</span>
                  <span className="text-muted-foreground text-xs">{peers.length === 1 ? "device" : "devices"}</span>
                </div>
              </div>
              <ul className="grid gap-1.5 text-sm">
                <PathRow icon={ZapIcon} color="var(--chart-1)" label="Direct" count={direct} />
                <PathRow icon={ServerIcon} color="var(--chart-2)" label="Relay" count={relayed} />
                {idle > 0 && <PathRow icon={ActivityIcon} color="var(--muted-foreground)" label="Idle" count={idle} />}
              </ul>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <MonitorSmartphoneIcon className="size-4" />
            Traffic by device
          </h2>
          {peers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Devices that join show up here with what they send and receive.</p>
          ) : (
            <ChartContainer config={perPeerConfig} className="aspect-auto w-full" style={{ height: Math.max(peers.length, 2) * 44 + 24 }}>
              <BarChart
                data={peers.map((p) => ({ name: p.name, rx: p.rxBytes ?? 0, tx: p.txBytes ?? 0 }))}
                layout="vertical"
                margin={{ left: 0, right: 8, top: 0, bottom: 0 }}
                barCategoryGap={12}
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatBytes(v)} tickCount={4} />
                <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent valueFormatter={formatBytes} />}
                />
                <Bar dataKey="rx" stackId="a" fill="var(--color-rx)" radius={[4, 0, 0, 4]} isAnimationActive={false} />
                <Bar dataKey="tx" stackId="a" fill="var(--color-tx)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          )}
        </div>
      </section>

      <Separator />

      {/* This device */}
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
          <GlobeIcon className="size-4" />
          This device
        </h2>
        <dl className="divide-border grid divide-y text-sm">
          <Row label="Mesh IPv4" value={status.device?.meshIpv4} />
          <Row label="Mesh IPv6" value={status.device?.meshIpv6} />
          <Row label="Public endpoint" value={status.publicEndpoint} />
          <Row label="Relay" value={status.relay ? `${status.relay.url} · ${status.relay.connected ? "online" : "offline"}` : undefined} />
          <Row label="Control plane" value={status.server} />
          <Row label="Version" value={status.version} />
        </dl>
      </section>
    </div>
  );
}

function Legend({
  color,
  icon: Icon,
  label,
  value,
}: {
  color: string;
  icon: typeof ArrowDownIcon;
  label: string;
  value: string;
}) {
  return (
    <span className="flex items-center gap-2" aria-label={label}>
      <span className="flex size-6 items-center justify-center rounded-md" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }}>
        <Icon className="size-3.5" style={{ color }} />
      </span>
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </span>
  );
}

function PathRow({ icon: Icon, color, label, count }: { icon: typeof ZapIcon; color: string; label: string; count: number }) {
  return (
    <li className="flex items-center gap-2">
      <Icon className="size-3.5" style={{ color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium tabular-nums">{count}</span>
    </li>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs">
        <CopyValue value={value} />
      </dd>
    </div>
  );
}

/** Click to copy. */
function CopyValue({ value }: { value?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      title="Copy"
      className="hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 font-mono"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <span className="truncate">{value}</span>
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3 opacity-50" />}
    </button>
  );
}
