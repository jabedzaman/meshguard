"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@meshguard/api-client";
import { Badge } from "@meshguard/ui/components/badge";
import { Button } from "@meshguard/ui/components/button";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { ConnectorDialog } from "~/components/connector-dialog";
import { ListSkeleton } from "~/components/list-skeleton";
import { OnlineDot } from "~/components/online-dot";
import { usePermission } from "~/components/providers/organization-provider";
import { connectorMutations, connectorQueries, deviceQueries } from "~/lib/queries";

/** App connectors: domains whose traffic goes through the first online host. */
export function ConnectorsList({ networkId }: { networkId: string }) {
  const { data: connectors, isPending, error } = useQuery(connectorQueries.list(networkId));
  const { data: devices = [] } = useQuery(deviceQueries.list(networkId));
  const canManage = usePermission({ device: ["update"] });
  const queryClient = useQueryClient();

  if (isPending) return <ListSkeleton label="Loading app connectors" />;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="text-sm font-medium">App connectors</h2>
          <p className="text-muted-foreground text-xs">
            Send the traffic for some domains through a device that can reach them, without routing
            everything.
          </p>
        </div>
        {canManage && <ConnectorDialog networkId={networkId} devices={devices} />}
      </div>
      {connectors.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
          No app connectors yet.
        </p>
      ) : (
        <ul className="divide-border bg-card divide-y rounded-xl border shadow-sm">
          {connectors.map((connector) => (
            <li
              key={connector.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 text-sm first:rounded-t-xl last:rounded-b-xl"
            >
              <div className="grid min-w-0 gap-1">
                <span className="font-medium">{connector.name}</span>
                <span className="flex flex-wrap gap-1.5">
                  {connector.domains.map((domain) => (
                    <Badge key={domain} variant="outline" className="font-mono font-normal">
                      {domain}
                    </Badge>
                  ))}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex flex-wrap items-center gap-2">
                  {connector.hosts.length === 0 && (
                    <span className="text-muted-foreground text-xs">no hosts</span>
                  )}
                  {connector.hosts.map((host) => (
                    <Badge key={host.id} variant="secondary" className="gap-1.5 font-normal">
                      <OnlineDot online={host.online} />
                      {host.name}
                    </Badge>
                  ))}
                </span>
                {canManage && (
                  <div className="flex items-center">
                    <ConnectorDialog
                      networkId={networkId}
                      devices={devices}
                      connector={connector}
                    />
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          aria-label={`Delete ${connector.name}`}
                        >
                          <Trash2Icon />
                        </Button>
                      }
                      triggerTooltip="Delete"
                      title={`Delete ${connector.name}?`}
                      description="Its domains go back to being reached the way they were before."
                      confirmLabel="Delete connector"
                      onConfirm={async () => {
                        await connectorMutations.remove(connector.id);
                        toast.success("Connector deleted");
                        await queryClient.invalidateQueries({ queryKey: connectorQueries.all() });
                      }}
                    />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
