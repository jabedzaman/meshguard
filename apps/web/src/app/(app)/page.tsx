import { CreateNetworkDialog } from "~/components/create-network-dialog";
import { NetworksList } from "~/components/networks-list";
import { PageHeader } from "~/components/page-header";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Networks"
        description="Each network is a private mesh: its devices reach each other directly."
        action={<CreateNetworkDialog />}
      />
      <NetworksList />
    </div>
  );
}
