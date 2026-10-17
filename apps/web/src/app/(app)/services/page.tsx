import { PageHeader } from "~/components/page-header";
import { ServicesList } from "~/components/services-list";

export default function ServicesPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Services"
        description="Named addresses that stay put while the devices behind them change."
      />
      <ServicesList />
    </div>
  );
}
