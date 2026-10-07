"use client";

import type { ComponentProps } from "react";
import { Button } from "@meshguard/ui/components/button";
import { useHydrated } from "~/hooks/use-hydrated";
import { useSignOutAll } from "~/hooks/use-session-navigation";

/** Signs out of every account on this browser. */
export function SignOutButton({
  children = "Sign out",
  variant = "outline",
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "type">) {
  const hydrated = useHydrated();
  const signOut = useSignOutAll();
  return (
    <Button
      type="button"
      variant={variant}
      disabled={!hydrated || signOut.isPending}
      onClick={() => signOut.mutate()}
      {...props}
    >
      {signOut.isPending ? "Signing out…" : children}
    </Button>
  );
}
