"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "@mesh/api-client";
import { Button } from "@mesh/ui/components/button";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { useCurrentUser, usePermission } from "~/components/providers/organization-provider";
import { enrollmentTokenMutations, enrollmentTokenQueries } from "~/lib/queries";

export function EnrollmentTokensList({ networkId }: { networkId: string }) {
  const currentUser = useCurrentUser();
  const canRevokeOthers = usePermission({ device: ["delete"] });
  const queryClient = useQueryClient();
  const { data: tokens, isPending, error } = useQuery(enrollmentTokenQueries.active(networkId));

  if (isPending) return <p className="text-muted-foreground text-sm">Loading tokens…</p>;
  if (error) return <p className="text-destructive text-sm">{getErrorMessage(error)}</p>;
  if (tokens.length === 0) {
    return <p className="text-muted-foreground text-sm">No active enrollment tokens.</p>;
  }

  return (
    <ul className="divide-border divide-y rounded-md border">
      {tokens.map((token) => {
        const mine = token.createdBy.id === currentUser.id;
        return (
          <li key={token.id} className="flex items-center justify-between gap-4 p-3 text-sm">
            <div className="grid">
              <span className="font-mono text-xs">{token.tokenPrefix}…</span>
              <span className="text-muted-foreground text-xs">
                {mine ? "you" : token.createdBy.email} · expires{" "}
                {new Date(token.expiresAt).toLocaleString()}
              </span>
            </div>
            {(mine || canRevokeOthers) && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm" aria-label={`Revoke ${token.tokenPrefix}`}>
                    Revoke
                  </Button>
                }
                title="Revoke this token?"
                description="Devices can no longer use it to join the network."
                confirmLabel="Revoke token"
                onConfirm={async () => {
                  await enrollmentTokenMutations.revoke(token.id);
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
