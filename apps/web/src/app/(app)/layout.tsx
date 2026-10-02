import { OrganizationSwitcher } from "~/components/organization-switcher";
import { OrganizationProvider } from "~/components/providers/organization-provider";
import { SignOutButton } from "~/components/sign-out-button";
import { getActiveOrganization, getSession, listOrganizations } from "~/lib/session";

export const dynamic = "force-dynamic";

// proxy.ts guarantees a session with an active organization on these routes.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, organization, organizations] = await Promise.all([
    getSession(),
    getActiveOrganization(),
    listOrganizations(),
  ]);
  if (!session || !organization) {
    throw new Error("(app) layout rendered without a session and active organization");
  }

  return (
    <OrganizationProvider
      organization={{ id: organization.id, name: organization.name, slug: organization.slug }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-6">
        <header className="flex items-center justify-between">
          <OrganizationSwitcher
            organizations={organizations.map(({ id, name, slug }) => ({ id, name, slug }))}
          />
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm">{session.user.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main>{children}</main>
      </div>
    </OrganizationProvider>
  );
}
