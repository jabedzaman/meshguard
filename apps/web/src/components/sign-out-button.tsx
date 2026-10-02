"use client";

import { useMutation } from "@tanstack/react-query";
import { Button } from "@mesh/ui/components/button";
import { authClient, unwrap } from "~/lib/auth-client";

export function SignOutButton({
  label = "Sign out",
  redirectTo = "/sign-in",
}: {
  label?: string;
  /** Where to go after signing out. */
  redirectTo?: string;
}) {
  const signOut = useMutation({
    mutationFn: () => unwrap(authClient.signOut()),
    // Full navigation drops every client cache (router and TanStack Query).
    onSuccess: () => window.location.assign(redirectTo),
  });

  return (
    <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
      {label}
    </Button>
  );
}
