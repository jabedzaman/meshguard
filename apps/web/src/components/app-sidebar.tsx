"use client";

import { ChevronDownIcon, NetworkIcon, ShieldIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@meshguard/ui/components/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@meshguard/ui/components/sidebar";
import {
  OrganizationSwitcher,
  type SwitchableOrganization,
} from "~/components/organization-switcher";

const NETWORK_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/devices", label: "Devices" },
  { href: "/apps", label: "Apps" },
  { href: "/services", label: "Services" },
];

const LINKS = [
  { href: "/access", label: "Access", icon: ShieldIcon },
  { href: "/members", label: "Members", icon: UsersIcon },
];

function NetworkMenu({ pathname }: { pathname: string }) {
  const childActive = NETWORK_LINKS.some(({ href }) => href === pathname);
  const [open, setOpen] = useState(childActive);

  // Navigating into a child (link, back/forward) opens the group.
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip="Network" className="group/network">
            <NetworkIcon />
            <span>Network</span>
            <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/network:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <SidebarMenuSub>
            {NETWORK_LINKS.map(({ href, label }) => (
              <SidebarMenuSubItem key={href}>
                <SidebarMenuSubButton asChild isActive={pathname === href}>
                  <Link href={href}>
                    <span>{label}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function AppSidebar({ organizations }: { organizations: SwitchableOrganization[] }) {
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
            <NetworkMenu pathname={pathname} />
            {LINKS.map(({ href, label, icon: Icon }) => (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton asChild isActive={pathname === href} tooltip={label}>
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
      <SidebarRail />
    </Sidebar>
  );
}
