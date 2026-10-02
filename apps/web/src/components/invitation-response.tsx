"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@meshguard/ui/components/button";
import { useHydrated } from "~/hooks/use-hydrated";
import { authClient, unwrap } from "~/lib/auth-client";

export function InvitationResponse({
  invitationId,
  organizationName,
}: {
  invitationId: string;
  organizationName: string;
}) {
  const hydrated = useHydrated();
  // Accepting makes the organization active; a full navigation drops caches.
  const accept = useMutation({
    mutationFn: () => unwrap(authClient.organization.acceptInvitation({ invitationId })),
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
    onSuccess: () => window.location.assign("/"),
  });
  const decline = useMutation({
    mutationFn: () => unwrap(authClient.organization.rejectInvitation({ invitationId })),
  });

  if (decline.isSuccess) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">You declined the invitation to {organizationName}.</p>
        <Button asChild variant="outline" className="self-start">
          <Link href="/">Continue</Link>
        </Button>
      </div>
    );
  }

  const error = accept.error ?? decline.error;
  const busy = !hydrated || accept.isPending || decline.isPending || accept.isSuccess;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => accept.mutate()}>
          {accept.isPending || accept.isSuccess ? "Joining…" : `Join ${organizationName}`}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => decline.mutate()}>
          {decline.isPending ? "Declining…" : "Decline"}
        </Button>
      </div>
    </div>
  );
}
