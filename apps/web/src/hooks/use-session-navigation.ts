"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { authClient, unwrap } from "~/lib/auth-client";

/**
 * Navigates after the session or active organization changed. Drops the
 * TanStack Query cache and the client router cache, so nothing from the
 * previous account or organization (or a cached redirect) survives.
 */
export function useResetNavigate() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return (href: string) => {
    queryClient.clear();
    router.replace(href);
    router.refresh();
  };
}

/** Signs out of every account on this browser. */
export function useSignOutAll() {
  const navigate = useResetNavigate();
  return useMutation({
    mutationFn: () => unwrap(authClient.signOut()),
    // The proxy sends a signed-out visitor to /sign-in.
    onSuccess: () => navigate("/"),
  });
}

/**
 * Signs out of one account. Another signed-in account, if any, becomes active;
 * otherwise the proxy sends the user to /sign-in.
 */
export function useSignOutAccount() {
  const navigate = useResetNavigate();
  return useMutation({
    mutationFn: (sessionToken: string) => unwrap(authClient.multiSession.revoke({ sessionToken })),
    onSuccess: () => navigate("/"),
  });
}

export function useSwitchAccount() {
  const navigate = useResetNavigate();
  return useMutation({
    mutationFn: (sessionToken: string) =>
      unwrap(authClient.multiSession.setActive({ sessionToken })),
    // Not the current page: the other account may not have access to it.
    onSuccess: () => navigate("/"),
  });
}
