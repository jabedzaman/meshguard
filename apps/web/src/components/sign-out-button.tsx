"use client";

import { useMutation } from "@tanstack/react-query";
import { Button } from "@mesh/ui/components/button";
import { authClient, unwrap } from "~/lib/auth-client";

export function SignOutButton() {
  const signOut = useMutation({
    mutationFn: () => unwrap(authClient.signOut()),
    // Full navigation drops every client cache (router and TanStack Query).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
    onSuccess: () => window.location.assign("/sign-in"),
  });

  return (
    <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
      Sign out
    </Button>
  );
}
