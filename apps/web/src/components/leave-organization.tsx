"use client";

import { Button } from "@meshguard/ui/components/button";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { useOrganization } from "~/components/providers/organization-provider";
import { authClient, unwrap } from "~/lib/auth-client";

export function LeaveOrganization() {
  const organization = useOrganization();

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-4">
      <div className="grid text-sm">
        <span className="font-medium">Leave {organization.name}</span>
        <span className="text-muted-foreground">
          You&apos;ll lose access to its networks and devices.
        </span>
      </div>
      <ConfirmDialog
        trigger={<Button variant="outline">Leave</Button>}
        title={`Leave ${organization.name}?`}
        description="You'll need a new invitation to rejoin."
        confirmLabel="Leave organization"
        onConfirm={async () => {
          await unwrap(authClient.organization.leave({ organizationId: organization.id }));
          // Better Auth clears this session's active organization; the proxy
          // then activates another one or sends the user to create one.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
          window.location.assign("/");
        }}
      />
    </div>
  );
}
