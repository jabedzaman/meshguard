"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@meshguard/api-client";
import { Button } from "@meshguard/ui/components/button";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { ListSkeleton } from "~/components/list-skeleton";
import { useCurrentUser, usePermission } from "~/components/providers/organization-provider";
import { enrollmentTokenMutations, enrollmentTokenQueries } from "~/lib/queries";
import { timeAgo } from "~/lib/time";

export function EnrollmentTokensList({ networkId }: { networkId: string }) {
  const currentUser = useCurrentUser();
  const canRevokeOthers = usePermission({ device: ["delete"] });
  const queryClient = useQueryClient();
  const { data: tokens, isPending, error } = useQuery(enrollmentTokenQueries.active(networkId));

  if (isPending) return <ListSkeleton rows={1} label="Loading tokens" />;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;
  if (tokens.length === 0) {
    return <p className="text-muted-foreground text-sm">No active enrollment tokens.</p>;
  }

  return (
    <ul className="divide-border bg-card divide-y rounded-xl border shadow-sm">
      {tokens.map((token) => {
        const mine = token.createdBy.id === currentUser.id;
        return (
          <li key={token.id} className="flex items-center justify-between gap-4 p-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="bg-amber-500/15 text-amber-600 dark:text-amber-400 flex size-9 items-center justify-center rounded-lg">
                <KeyRoundIcon className="size-4" />
              </span>
              <div className="grid gap-0.5">
                <span className="font-mono text-xs">{token.tokenPrefix}…</span>
                <span
                  className="text-muted-foreground text-xs"
                  title={new Date(token.expiresAt).toLocaleString()}
                >
                  {mine ? "you" : token.createdBy.email} · expires {timeAgo(token.expiresAt)}
                </span>
              </div>
            </div>
            {(mine || canRevokeOthers) && (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hover:text-destructive"
                    aria-label={`Revoke ${token.tokenPrefix}`}
                  >
                    <Trash2Icon />
                  </Button>
                }
                triggerTooltip="Revoke"
                title="Revoke this token?"
                description="Devices can no longer use it to join the network."
                confirmLabel="Revoke token"
                onConfirm={async () => {
                  await enrollmentTokenMutations.revoke(token.id);
                  toast.success("Token revoked");
                  await queryClient.invalidateQueries({ queryKey: enrollmentTokenQueries.all() });
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
