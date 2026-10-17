import { useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@meshguard/ui/components/card";
import { Button } from "@meshguard/ui/components/button";
import { agent, errorMessage, type AgentState } from "~/lib/agent";

type Props = { state: Exclude<AgentState, { kind: "running" }> };

const copy = {
  not_installed: {
    title: "Finish setting up MeshGuard",
    body: "MeshGuard runs a small background service that manages your connection, and a meshguard command for the terminal. Installing them asks for your password once.",
    action: "Install service",
  },
  not_running: {
    title: "The MeshGuard service isn't running",
    body: "It's installed but not answering. Reinstalling restarts it.",
    action: "Reinstall service",
  },
  denied: {
    title: "This account can't control the service",
    body: "The service was installed for another user. Reinstalling makes this account its owner.",
    action: "Reinstall service",
  },
} as const;

export function Setup({ state }: Props) {
  const [busy, setBusy] = useState(false);
  const c = copy[state.kind];
  const Icon = state.kind === "not_installed" ? ShieldCheck : ShieldAlert;

  async function install() {
    setBusy(true);
    try {
      await agent.install();
    } catch (e) {
      if (errorMessage(e) !== "cancelled") toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Icon className="text-muted-foreground mb-2 size-8" />
          <CardTitle>{c.title}</CardTitle>
          <CardDescription>{c.body}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.kind === "denied" && <p className="text-muted-foreground text-xs">{state.message}</p>}
          <Button onClick={install} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {c.action}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
