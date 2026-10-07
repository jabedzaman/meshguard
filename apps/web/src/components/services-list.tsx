"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NetworkIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@meshguard/api-client";
import { Badge } from "@meshguard/ui/components/badge";
import { Button } from "@meshguard/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@meshguard/ui/components/empty";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { ListSkeleton } from "~/components/list-skeleton";
import { OnlineDot } from "~/components/online-dot";
import { usePermission } from "~/components/providers/organization-provider";
import { ServiceDialog } from "~/components/service-hosts-dialog";
import { aclQueries, deviceQueries, serviceMutations, serviceQueries } from "~/lib/queries";

/** The network's services: a name and an address served by the first online host. */
export function ServicesList({ networkId }: { networkId: string }) {
  const { data: services, isPending, error } = useQuery(serviceQueries.list(networkId));
  const { data: devices = [] } = useQuery(deviceQueries.list(networkId));
  const canManage = usePermission({ device: ["update"] });
  const queryClient = useQueryClient();

  if (isPending) return <ListSkeleton label="Loading services" />;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex justify-end">
          <ServiceDialog networkId={networkId} devices={devices} />
        </div>
      )}
      {services.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NetworkIcon />
            </EmptyMedia>
            <EmptyTitle>No services yet.</EmptyTitle>
            <EmptyDescription>
              A service gives a name and an address to whatever its host devices run, so people
              connect to <code>web.svc.&lt;network domain&gt;</code> instead of a device.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-border bg-card divide-y rounded-xl border shadow-sm">
          {services.map((service) => (
            <li
              key={service.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 text-sm first:rounded-t-xl last:rounded-b-xl"
            >
              <div className="grid min-w-0 gap-1">
                <span className="font-medium">{service.name}</span>
                <span className="text-muted-foreground font-mono text-xs">{service.dnsName}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className="font-mono font-normal">
                  {service.vip}
                </Badge>
                <span className="flex flex-wrap items-center gap-2">
                  {service.hosts.length === 0 && (
                    <span className="text-muted-foreground text-xs">no hosts</span>
                  )}
                  {service.hosts.map((host) => (
                    <Badge key={host.id} variant="secondary" className="gap-1.5 font-normal">
                      <OnlineDot online={host.online} />
                      {host.name}
                    </Badge>
                  ))}
                </span>
                {canManage && (
                  <div className="flex items-center">
                    <ServiceDialog networkId={networkId} devices={devices} service={service} />
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          aria-label={`Delete ${service.name}`}
                        >
                          <Trash2Icon />
                        </Button>
                      }
                      triggerTooltip="Delete"
                      title={`Delete ${service.name}?`}
                      description="Its name and address stop working, and access rules that name it are removed."
                      confirmLabel="Delete service"
                      onConfirm={async () => {
                        await serviceMutations.remove(service.id);
                        toast.success("Service deleted");
                        await queryClient.invalidateQueries({ queryKey: serviceQueries.all() });
                        await queryClient.invalidateQueries({ queryKey: aclQueries.all() });
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
