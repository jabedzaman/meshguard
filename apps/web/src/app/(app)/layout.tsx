import { redirect } from "next/navigation";
import { SignOutButton } from "~/components/sign-out-button";
import { getActiveOrganization, getSession, listOrganizations } from "~/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, organizations, activeOrganization] = await Promise.all([
    getSession(),
    listOrganizations(),
    getActiveOrganization(),
  ]);

  if (!session) {
    redirect("/sign-in");
  }
  if (!activeOrganization) {
    const [first] = organizations;
    if (first) {
      redirect(`/api/org/recover?organizationId=${encodeURIComponent(first.id)}`);
    }
    redirect("/organizations/create");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{activeOrganization.name}</h1>
          <p className="text-muted-foreground text-sm">{session.user.email}</p>
        </div>
        <SignOutButton />
      </header>
      <main>{children}</main>
    </div>
  );
}
