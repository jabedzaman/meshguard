import { redirect } from "next/navigation";
import { NetworksList } from "~/components/networks-list";
import { getActiveOrganization } from "~/lib/session";

export default async function DashboardPage() {
  // Already resolved by the layout in this request (React cache).
  const organization = await getActiveOrganization();
  if (!organization) redirect("/organizations/create");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Networks</h2>
      <NetworksList organizationId={organization.id} />
    </section>
  );
}
