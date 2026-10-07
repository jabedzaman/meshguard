"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
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
import {
  type ActiveOrganization,
  useOrganization,
} from "~/components/providers/organization-provider";
import { authClient, unwrap } from "~/lib/auth-client";

export function OrganizationSwitcher({ organizations }: { organizations: ActiveOrganization[] }) {
  const active = useOrganization();
  const { isMobile } = useSidebar();

  const switchOrganization = useMutation({
    mutationFn: (organizationId: string) =>
      unwrap(authClient.organization.setActive({ organizationId })),
    // Full navigation drops router and query caches holding the previous org's data.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
    onSuccess: () => window.location.assign("/"),
  });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              disabled={switchOrganization.isPending}
            >
              <span className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg text-sm font-semibold uppercase">
                {active.name[0]}
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{active.name}</span>
                <span className="text-muted-foreground truncate text-xs">{active.slug}</span>
              </span>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Organizations
            </DropdownMenuLabel>
            {organizations.map((organization) => (
              <DropdownMenuItem
                key={organization.id}
                onSelect={() => {
                  if (organization.id !== active.id) switchOrganization.mutate(organization.id);
                }}
              >
                <span className="flex-1 truncate">{organization.name}</span>
                {organization.id === active.id && <CheckIcon className="size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/organizations/create" className="text-muted-foreground">
                <PlusIcon className="size-4" />
                New organization
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
