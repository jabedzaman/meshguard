import { OrganizationProvider } from "~/components/providers/organization-provider";
import { SignOutButton } from "~/components/sign-out-button";
import { getActiveOrganization, getSession } from "~/lib/session";

export const dynamic = "force-dynamic";

// proxy.ts guarantees a session with an active organization on these routes.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, organization] = await Promise.all([getSession(), getActiveOrganization()]);
  if (!session || !organization) {
    throw new Error("(app) layout rendered without a session and active organization");
  }

  return (
    <OrganizationProvider
      organization={{ id: organization.id, name: organization.name, slug: organization.slug }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{organization.name}</h1>
            <p className="text-muted-foreground text-sm">{session.user.email}</p>
          </div>
          <SignOutButton />
        </header>
        <main>{children}</main>
      </div>
    </OrganizationProvider>
  );
}
