"use client";

import { NetworkIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@meshguard/ui/components/sidebar";
import { NavUser } from "~/components/nav-user";
import { OrganizationSwitcher } from "~/components/organization-switcher";
import type { ActiveOrganization } from "~/components/providers/organization-provider";

const LINKS = [
  { href: "/", label: "Networks", icon: NetworkIcon },
  { href: "/members", label: "Members", icon: UsersIcon },
];

function isActive(pathname: string, href: string) {
  // Network pages live under "/networks/…" but belong to Networks.
  return href === "/" ? pathname === "/" || pathname.startsWith("/networks") : pathname === href;
}

export function AppSidebar({ organizations }: { organizations: ActiveOrganization[] }) {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher organizations={organizations} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Organization</SidebarGroupLabel>
          <SidebarMenu>
            {LINKS.map(({ href, label, icon: Icon }) => (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton asChild isActive={isActive(pathname, href)} tooltip={label}>
                  <Link href={href}>
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
