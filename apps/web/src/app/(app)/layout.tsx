import { AppNav } from "~/components/app-nav";
import { OrganizationSwitcher } from "~/components/organization-switcher";
import { OrganizationProvider } from "~/components/providers/organization-provider";
import { SignOutButton } from "~/components/sign-out-button";
import { ROLES, type Role } from "@mesh/auth/permissions";
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
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
        <header className="flex items-center justify-between gap-3">
          <OrganizationSwitcher
            organizations={organizations.map(({ id, name, slug }) => ({ id, name, slug }))}
          />
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {session.user.email} · {role}
            </span>
            <SignOutButton />
          </div>
        </header>
        <AppNav />
        <main>{children}</main>
      </div>
    </OrganizationProvider>
  );
}

function parseRole(value: string): Role {
  // Better Auth stores roles as a string; we assign exactly one per member.
  if ((ROLES as string[]).includes(value)) return value as Role;
  throw new Error(`Unknown organization role: ${value}`);
}
