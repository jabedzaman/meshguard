import type { Metadata } from "next";
import { MyInvitations } from "~/components/my-invitations";
import { listMyInvitations } from "~/lib/invitations";
import { CreateOrganization } from "~/components/create-organization";

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
