import { LaptopIcon, LayoutDashboardIcon, SettingsIcon } from "lucide-react";
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
import { LogoMark } from "~/components/logo";
import type { Status } from "~/lib/agent";

export type Page = "overview" | "devices" | "settings";

const NETWORK_LINKS: { page: Page; label: string; icon: typeof LaptopIcon }[] = [
  { page: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { page: "devices", label: "Devices", icon: LaptopIcon },
];

export function AppSidebar({ status, page, onNavigate }: { status: Status; page: Page; onNavigate: (page: Page) => void }) {
  return (
    <Sidebar variant="inset" collapsible="icon">
      {/* Room for the macOS window buttons, and a place to drag the window. */}
      <div data-tauri-drag-region className="h-8 shrink-0" />
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
              <LogoMark />
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{status.network?.name}</span>
                <span className="text-muted-foreground truncate text-xs">MeshGuard</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Network</SidebarGroupLabel>
          <SidebarMenu>
            {NETWORK_LINKS.map(({ page: target, label, icon: Icon }) => (
              <SidebarMenuItem key={target}>
                <SidebarMenuButton isActive={page === target} tooltip={label} onClick={() => onNavigate(target)}>
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={page === "settings"} tooltip="Settings" onClick={() => onNavigate("settings")}>
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
