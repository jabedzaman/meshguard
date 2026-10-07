"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@meshguard/ui/components/button";
import { ListSkeleton } from "~/components/list-skeleton";
import { useOrganization, usePermission } from "~/components/providers/organization-provider";
import { authClient, unwrap } from "~/lib/auth-client";
import { invitationQueries } from "~/lib/queries";
import { timeAgo } from "~/lib/time";

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
    onSuccess: async () => {
      toast.success("Invitation cancelled");
      await queryClient.invalidateQueries({ queryKey: invitationQueries.all() });
    },
  });

  if (isPending) return <ListSkeleton rows={1} label="Loading invitations" />;
  if (error) return <p className="text-destructive text-sm">{error.message}</p>;
  if (invitations.length === 0) {
    return <p className="text-muted-foreground text-sm">No pending invitations.</p>;
  }

  return (
    <ul className="divide-border bg-card divide-y rounded-xl border shadow-sm">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="flex items-center justify-between gap-4 p-4 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
              <MailIcon className="size-4" />
            </span>
            <div className="grid min-w-0">
              <span className="truncate font-medium">{invitation.email}</span>
              <span
                className="text-muted-foreground text-xs"
                title={new Date(invitation.expiresAt).toLocaleString()}
              >
                {invitation.role} · expires {timeAgo(invitation.expiresAt)}
              </span>
            </div>
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
