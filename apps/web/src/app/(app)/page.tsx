import { NetworksList } from "~/components/networks-list";

export default function DashboardPage() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Networks</h2>
      <NetworksList />
    </section>
  );
}
