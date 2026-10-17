import { SidebarInset, SidebarProvider, SidebarTrigger } from "@meshguard/ui/components/sidebar";
import { AppSidebar } from "~/components/app-sidebar";
import { NavUser } from "~/components/nav-user";
import { OrganizationProvider } from "~/components/providers/organization-provider";
import { ROLES, type Role } from "@meshguard/auth/permissions";
import { orgUrl } from "~/lib/org-host";
import {
  getActiveMember,
  getActiveOrganization,
  getSession,
  listOrganizations,
} from "~/lib/session";

export const dynamic = "force-dynamic";

// proxy.ts guarantees a session with an active organization on these routes.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, organization, organizations, member] = await Promise.all([
    getSession(),
    getActiveOrganization(),
    listOrganizations(),
    getActiveMember(),
  ]);
  if (!session || !organization || !member) {
    throw new Error("(app) layout rendered without a session and active organization");
  }
  const role = parseRole(member.role);

  return (
    <OrganizationProvider
      organization={{ id: organization.id, name: organization.name, slug: organization.slug }}
      role={role}
      user={{ id: session.user.id, email: session.user.email }}
    >
      <SidebarProvider>
        <AppSidebar
          organizations={organizations.map(({ id, name, slug }) => ({
            id,
            name,
            slug,
            url: orgUrl(slug),
          }))}
        />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto">
              <NavUser />
            </div>
          </header>
          <div className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </OrganizationProvider>
  );
}

function parseRole(value: string): Role {
  // Better Auth stores roles as a string; we assign exactly one per member.
  if ((ROLES as string[]).includes(value)) return value as Role;
  throw new Error(`Unknown organization role: ${value}`);
}
