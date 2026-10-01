"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@mesh/ui/components/button";
import { authClient, unwrap } from "~/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const signOut = useMutation({
    mutationFn: () => unwrap(authClient.signOut()),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/sign-in");
      router.refresh();
    },
  });

  return (
    <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
      Sign out
    </Button>
  );
}
