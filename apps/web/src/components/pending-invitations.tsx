"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@mesh/ui/components/button";
import { useOrganization, usePermission } from "~/components/providers/organization-provider";
import { authClient, unwrap } from "~/lib/auth-client";
import { invitationQueries } from "~/lib/queries";

export function PendingInvitations() {
  const organization = useOrganization();
  const canCancel = usePermission({ invitation: ["cancel"] });
  const queryClient = useQueryClient();
  const {
    data: invitations,
    isPending,
    error,
  } = useQuery(invitationQueries.pending(organization.id));

  const cancel = useMutation({
    mutationFn: (invitationId: string) =>
      unwrap(authClient.organization.cancelInvitation({ invitationId })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationQueries.all() }),
  });

  if (isPending) return <p className="text-muted-foreground text-sm">Loading invitations…</p>;
  if (error) return <p className="text-destructive text-sm">{error.message}</p>;
  if (invitations.length === 0) {
    return <p className="text-muted-foreground text-sm">No pending invitations.</p>;
  }

  return (
    <ul className="divide-border divide-y rounded-md border">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="flex items-center justify-between gap-4 p-3 text-sm">
          <div className="grid">
            <span className="font-medium">{invitation.email}</span>
            <span className="text-muted-foreground text-xs">
              {invitation.role} · expires {new Date(invitation.expiresAt).toLocaleString()}
            </span>
          </div>
          {canCancel && (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending && cancel.variables === invitation.id}
              onClick={() => cancel.mutate(invitation.id)}
            >
              Cancel
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
