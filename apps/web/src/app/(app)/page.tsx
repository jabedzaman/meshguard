import { CreateNetworkForm } from "~/components/create-network-form";
import { NetworksList } from "~/components/networks-list";

export default function DashboardPage() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-medium">Networks</h2>
      <CreateNetworkForm />
      <NetworksList />
    </section>
  );
}
