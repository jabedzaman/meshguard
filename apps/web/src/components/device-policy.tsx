"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getErrorMessage } from "@meshguard/api-client";
import { Label } from "@meshguard/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@meshguard/ui/components/select";
import { Switch } from "@meshguard/ui/components/switch";
import { usePermission } from "~/components/providers/organization-provider";
import { networkMutations, networkQueries } from "~/lib/queries";

const EXPIRY_CHOICES = [30, 90, 180, 365];

/** How long keys last and whether new devices need approval, for owners and admins. */
export function DevicePolicy() {
  const canEdit = usePermission({ network: ["update"] });
  const queryClient = useQueryClient();
  const { data: network } = useQuery(networkQueries.current());
  const update = useMutation({
    mutationFn: networkMutations.update,
    onSuccess: () => {
      toast.success("Device policy saved");
      return queryClient.invalidateQueries({ queryKey: networkQueries.all() });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  if (!network || !canEdit) return null;

  const days = network.keyExpiryDays;
  const choices =
    days !== null && !EXPIRY_CHOICES.includes(days) ? [...EXPIRY_CHOICES, days] : EXPIRY_CHOICES;

  return (
    <section className="bg-card flex flex-col gap-4 rounded-xl border p-4 text-sm shadow-sm">
      <h2 className="text-muted-foreground text-sm font-medium">Device policy</h2>
      <div className="flex items-start gap-3">
        <Switch
          id="device-approval"
          checked={network.deviceApproval}
          disabled={update.isPending}
          onCheckedChange={(deviceApproval) => update.mutate({ deviceApproval })}
        />
        <div className="grid gap-0.5">
          <Label htmlFor="device-approval">Approve new devices</Label>
          <p className="text-muted-foreground text-xs">
            New devices wait for an owner or admin before peers can see them. Pre-approved keys skip
            this.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <Label htmlFor="key-expiry">Key expiry</Label>
          <p className="text-muted-foreground text-xs">
            A device is refused when its key ends, until an owner or admin renews it. Applies to
            keys issued or renewed from now on.
          </p>
        </div>
        <Select
          value={days === null ? "never" : String(days)}
          disabled={update.isPending}
          onValueChange={(value) =>
            update.mutate({ keyExpiryDays: value === "never" ? null : Number(value) })
          }
        >
          <SelectTrigger id="key-expiry" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice} value={String(choice)}>
                {choice} days
              </SelectItem>
            ))}
            <SelectItem value="never">Never</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
