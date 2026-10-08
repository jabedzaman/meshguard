import type { Metadata } from "next";
import { MyInvitations } from "~/components/my-invitations";
import { listMyInvitations } from "~/lib/invitations";
import { CreateOrganization } from "~/components/create-organization";

// Reads the session and invitations per request; never prerender at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Create organization" };

export default async function CreateOrganizationPage() {
  const invitations = await listMyInvitations();
  return (
    <>
      <MyInvitations invitations={invitations} />
      <CreateOrganization />
    </>
  );
}
