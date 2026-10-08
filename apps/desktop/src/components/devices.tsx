import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@meshguard/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@meshguard/ui/components/card";
import { ScrollArea } from "@meshguard/ui/components/scroll-area";
import { Switch } from "@meshguard/ui/components/switch";
import { agent, errorMessage, type Status } from "~/lib/agent";

const stateLabel: Record<Status["state"], string> = {
  connected: "Connected",
  enrolled: "Connecting…",
  down: "Disconnected",
  not_enrolled: "Not signed in",
};

export function Devices({ status }: { status: Status }) {
  const [busy, setBusy] = useState(false);
  const on = status.state === "connected" || status.state === "enrolled";
  const peers = status.peers ?? [];

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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{status.device?.name}</span>
              <Badge variant={status.state === "connected" ? "default" : "secondary"}>{stateLabel[status.state]}</Badge>
            </div>
            <p className="text-muted-foreground truncate text-sm">
              {status.network?.name} · <span className="font-mono">{status.device?.meshIpv4}</span>
            </p>
            {status.problem && <p className="text-destructive mt-1 text-xs">{status.problem}</p>}
          </div>
          {busy ? (
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          ) : (
            <Switch checked={on} onCheckedChange={toggle} aria-label="Connect to the mesh" />
          )}
        </CardContent>
      </Card>

      <Card className="min-h-0 flex-1">
        <CardHeader>
          <CardTitle className="text-sm">Devices in {status.network?.name} ({peers.length})</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          {peers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {on ? "No other devices yet." : "Connect to see the other devices."}
            </p>
          ) : (
            <ScrollArea className="h-full">
              <ul className="divide-y">
                {peers.map((p) => (
                  <li key={p.dnsName || p.name} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground font-mono text-xs">{p.meshIpv4}</span>
                      <Badge variant="outline">{p.viaRelay ? "relay" : p.endpoint ? "direct" : "idle"}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
