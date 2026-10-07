"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, ListChecksIcon, ShieldAlertIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@meshguard/api-client";
import { Badge } from "@meshguard/ui/components/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@meshguard/ui/components/empty";
import { Button } from "@meshguard/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@meshguard/ui/components/select";
import { AccessCheck } from "~/components/access-check";
import { AddAccessRuleDialog } from "~/components/add-access-rule-dialog";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { ListSkeleton } from "~/components/list-skeleton";
import { usePermission } from "~/components/providers/organization-provider";
import { aclMutations, aclQueries, type AclDefaultAction, deviceQueries } from "~/lib/queries";

const DEFAULT_ACTIONS: { value: AclDefaultAction; label: string }[] = [
  { value: "allow", label: "Every device reaches every other" },
  { value: "deny", label: "Only what the rules allow" },
];

function describeTraffic(rule: {
  protocol: "any" | "tcp" | "udp" | "icmp";
  portFrom: number | null;
  portTo: number | null;
}) {
  if (rule.protocol === "any") return "all traffic";
  if (rule.protocol === "icmp") return "ICMP (ping)";
  const protocol = rule.protocol.toUpperCase();
  if (rule.portFrom === null) return `${protocol}, all ports`;
  if (rule.portTo === null || rule.portTo === rule.portFrom) return `${protocol} ${rule.portFrom}`;
  return `${protocol} ${rule.portFrom}-${rule.portTo}`;
}

/** Who may reach whom in the network. Agents apply changes within a second or two. */
export function AccessRules({ networkId }: { networkId: string }) {
  const canEdit = usePermission({ network: ["update"] });
  const queryClient = useQueryClient();
  const { data: acl, isPending, error } = useQuery(aclQueries.get(networkId));
  const { data: devices = [] } = useQuery(deviceQueries.list(networkId));
  const setDefault = useMutation({
    mutationFn: (action: AclDefaultAction) => aclMutations.setDefaultAction(networkId, action),
    onSuccess: async (_, action) => {
      toast.success(
        action === "deny" ? "Only rules allow traffic now" : "Every device reaches every other",
      );
      await queryClient.invalidateQueries({ queryKey: aclQueries.all() });
    },
  });

  if (isPending) return <ListSkeleton label="Loading access rules" />;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;

  const enforced = acl.defaultAction === "deny";

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 shadow-sm">
        <div className="grid gap-0.5">
          <span className="text-sm font-medium">Default policy</span>
          <span className="text-muted-foreground text-xs">
            What happens to traffic no rule mentions.
          </span>
        </div>
        {canEdit ? (
          <Select
            value={acl.defaultAction}
            disabled={setDefault.isPending}
            onValueChange={(value) => setDefault.mutate(value as AclDefaultAction)}
          >
            <SelectTrigger className="w-72" aria-label="Access between devices">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEFAULT_ACTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm">
            {DEFAULT_ACTIONS.find((option) => option.value === acl.defaultAction)?.label}
          </p>
        )}
      </div>
      {setDefault.error && (
        <p role="alert" className="text-destructive text-sm">
          {getErrorMessage(setDefault.error)}
        </p>
      )}
      {enforced && acl.rules.length === 0 && (
        <p className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <ShieldAlertIcon className="size-4 shrink-0" />
          No rules yet: devices can&apos;t open connections to each other.
        </p>
      )}
      {!enforced && acl.rules.length > 0 && (
        <p className="text-muted-foreground text-sm">
          These rules take effect when access is limited to what the rules allow.
        </p>
      )}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-muted-foreground text-sm font-medium">Rules</h2>
          {canEdit && <AddAccessRuleDialog networkId={networkId} devices={devices} />}
        </div>
        {acl.rules.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecksIcon />
              </EmptyMedia>
              <EmptyTitle>No access rules.</EmptyTitle>
              <EmptyDescription>
                Rules allow traffic from one device, tag, person or role to another.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-border bg-card divide-y rounded-xl border shadow-sm">
            {acl.rules.map((rule, index) => {
              const source = rule.source.kind === "any" ? "Any device" : rule.source.label;
              const destination =
                rule.destination.kind === "any" ? "every device" : rule.destination.label;
              const label = `${source} → ${destination}`;
              return (
                <li key={rule.id} className="flex items-center justify-between gap-4 p-4 text-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-xs">
                      {index + 1}
                    </span>
                    <span className="sr-only">{label}</span>
                    <span aria-hidden className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-mono">
                        {source}
                      </Badge>
                      <ArrowRightIcon className="text-muted-foreground size-3.5" />
                      <Badge variant="secondary" className="font-mono">
                        {destination}
                      </Badge>
                      <Badge variant="outline">{describeTraffic(rule)}</Badge>
                    </span>
                  </div>
                  {canEdit && (
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          aria-label={`Remove rule ${label}`}
                        >
                          <Trash2Icon />
                        </Button>
                      }
                      triggerTooltip="Remove rule"
                      title="Remove this rule?"
                      description={`${label} (${describeTraffic(rule)}) is no longer allowed. Devices refuse new connections within a few seconds.`}
                      confirmLabel="Remove rule"
                      onConfirm={async () => {
                        await aclMutations.removeRule(rule.id);
                        toast.success("Rule removed");
                        await queryClient.invalidateQueries({ queryKey: aclQueries.all() });
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <AccessCheck networkId={networkId} devices={devices} />
    </div>
  );
}
