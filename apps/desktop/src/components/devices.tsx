import { LaptopIcon } from "lucide-react";
import { Badge } from "@meshguard/ui/components/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@meshguard/ui/components/empty";
import { ScrollArea } from "@meshguard/ui/components/scroll-area";
import { OnlineDot } from "~/components/online-dot";
import { PageHeader } from "~/components/page-header";
import type { Status } from "~/lib/agent";

export function Devices({ status }: { status: Status }) {
  const on = status.state === "connected" || status.state === "enrolled";
  const peers = status.peers ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        title="Devices"
        description={`${peers.length} other ${peers.length === 1 ? "device" : "devices"} in ${status.network?.name}`}
      />

      {peers.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LaptopIcon />
            </EmptyMedia>
            <EmptyTitle>{on ? "No other devices yet." : "Not connected."}</EmptyTitle>
            <EmptyDescription>
              {on ? "Devices show up here the moment they join." : "Connect to see the other devices."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="divide-border bg-card glass divide-y rounded-2xl border">
            {peers.map((p) => {
              const online = !!(p.viaRelay || p.endpoint);
              return (
                <li key={p.dnsName || p.name} className="flex items-center justify-between gap-4 p-4 text-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-muted relative flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <LaptopIcon className="text-muted-foreground size-4" />
                      <OnlineDot
                        online={online}
                        className="ring-card absolute -right-0.5 -bottom-0.5 rounded-full ring-2"
                      />
                    </span>
                    <div className="grid min-w-0 gap-0.5">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">{p.meshIpv4}</span>
                    </div>
                  </div>
                  <Badge variant="outline">{p.viaRelay ? "relay" : p.endpoint ? "direct" : "idle"}</Badge>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
