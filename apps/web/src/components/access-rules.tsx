"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "@meshguard/api-client";
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aclQueries.all() }),
  });

  if (isPending) return <p className="text-muted-foreground text-sm">Loading access rules…</p>;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;

  const enforced = acl.defaultAction === "deny";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        {canEdit && <AddAccessRuleDialog networkId={networkId} devices={devices} />}
      </div>
      {setDefault.error && (
        <p role="alert" className="text-destructive text-sm">
          {getErrorMessage(setDefault.error)}
        </p>
      )}
      {enforced && acl.rules.length === 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          No rules yet: devices can&apos;t open connections to each other.
        </p>
      )}
      {!enforced && acl.rules.length > 0 && (
        <p className="text-muted-foreground text-sm">
          These rules take effect when access is limited to what the rules allow.
        </p>
      )}
      {acl.rules.length > 0 && (
        <ul className="divide-border divide-y rounded-md border">
          {acl.rules.map((rule) => {
            const label = `${rule.source.kind === "any" ? "Any device" : rule.source.label} → ${rule.destination.kind === "any" ? "every device" : rule.destination.label}`;
            return (
              <li key={rule.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div className="grid">
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground text-xs">{describeTraffic(rule)}</span>
                </div>
                {canEdit && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm" aria-label={`Remove rule ${label}`}>
                        Remove
                      </Button>
                    }
                    title="Remove this rule?"
                    description={`${label} (${describeTraffic(rule)}) is no longer allowed. Devices refuse new connections within a few seconds.`}
                    confirmLabel="Remove rule"
                    onConfirm={async () => {
                      await aclMutations.removeRule(rule.id);
                      await queryClient.invalidateQueries({ queryKey: aclQueries.all() });
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AccessCheck networkId={networkId} devices={devices} />
    </div>
  );
}
