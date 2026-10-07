"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon, LogOutIcon, MoonIcon, PlusIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@meshguard/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@meshguard/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@meshguard/ui/components/sidebar";
import { useCurrentUser, useRole } from "~/components/providers/organization-provider";
import { useSignOutAccount, useSignOutAll, useSwitchAccount } from "~/hooks/use-session-navigation";
import { ADD_ACCOUNT_PARAM } from "~/lib/redirect";
import { authClient, unwrap } from "~/lib/auth-client";

export function NavUser() {
  const user = useCurrentUser();
  const role = useRole();
  const { isMobile } = useSidebar();
  const { resolvedTheme, setTheme } = useTheme();
  const signOutAll = useSignOutAll();
  const signOutAccount = useSignOutAccount();

  const sessions = useQuery({
    queryKey: ["device-sessions"],
    queryFn: () => unwrap(authClient.multiSession.listDeviceSessions()),
  });
  const switchAccount = useSwitchAccount();
  const otherAccounts = (sessions.data ?? []).filter((s) => s.user.id !== user.id);
  const currentToken = sessions.data?.find((s) => s.user.id === user.id)?.session.token;
  const signingOut = signOutAll.isPending || signOutAccount.isPending;

  const identity = (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg uppercase">{user.email[0]}</AvatarFallback>
      </Avatar>
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.email}</span>
        <span className="text-muted-foreground truncate text-xs">{role}</span>
      </span>
    </>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {identity}
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5">{identity}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {otherAccounts.map(({ session, user: account }) => (
              <DropdownMenuItem
                key={session.token}
                disabled={switchAccount.isPending}
                onSelect={() => switchAccount.mutate(session.token)}
              >
                <Avatar className="size-5 rounded">
                  <AvatarFallback className="rounded text-xs uppercase">
                    {account.email[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{account.email}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild>
              <Link href={`/sign-in?${ADD_ACCOUNT_PARAM}=1`}>
                <PlusIcon />
                Add account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {/* CSS picks the icon, so server and client render the same markup. */}
              <SunIcon className="hidden dark:block" />
              <MoonIcon className="dark:hidden" />
              Toggle theme
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={signingOut}
              onSelect={() =>
                // With several accounts, sign out of this one and fall back to another.
                currentToken && otherAccounts.length > 0
                  ? signOutAccount.mutate(currentToken)
                  : signOutAll.mutate()
              }
            >
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
            {otherAccounts.length > 0 && (
              <DropdownMenuItem disabled={signingOut} onSelect={() => signOutAll.mutate()}>
                <LogOutIcon />
                Sign out of all accounts
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
