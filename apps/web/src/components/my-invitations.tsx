"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meshguard/ui/components/card";
import { InvitationResponse } from "~/components/invitation-response";
import type { MyInvitation } from "~/lib/invitations";

/** Pending invitations addressed to the signed-in user's email. */
export function MyInvitations({ invitations }: { invitations: MyInvitation[] }) {
  if (invitations.length === 0) return null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>You&apos;ve been invited</CardTitle>
        <CardDescription>Join an existing organization instead.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {invitations.map((invitation) => (
          <div key={invitation.id} className="flex flex-col gap-2">
            <p className="text-sm">
              <strong>{invitation.organizationName}</strong> as {invitation.role}
            </p>
            <InvitationResponse
              invitationId={invitation.id}
              organizationName={invitation.organizationName}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
