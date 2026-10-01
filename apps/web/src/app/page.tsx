"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@mesh/ui/components/button";
import { CreateOrganization } from "~/components/create-organization";
import { NetworksList } from "~/components/networks-list";
import { authClient } from "~/lib/auth-client";

type SessionData = NonNullable<ReturnType<typeof authClient.useSession>["data"]>;

export default function Home() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) router.replace("/sign-in");
  }, [isPending, session, router]);

  if (isPending || !session) return null;
  return <Dashboard session={session} />;
}

// Rendered only with a session, so organization hooks never fire while signed out.
function Dashboard({ session }: { session: SessionData }) {
  const router = useRouter();
  const { data: organization } = authClient.useActiveOrganization();
  const activeOrganizationId = session.session.activeOrganizationId;

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{organization?.name ?? "Mesh"}</h1>
          <p className="text-muted-foreground text-sm">{session.user.email}</p>
        </div>
        <Button variant="outline" onClick={signOut}>
          Sign out
        </Button>
      </header>

      {activeOrganizationId ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Networks</h2>
          <NetworksList organizationId={activeOrganizationId} />
        </section>
      ) : (
        <div className="flex justify-center">
          <CreateOrganization />
        </div>
      )}
    </main>
  );
}
