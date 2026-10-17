import { ConnectorsList } from "~/components/connectors-list";
import { PageHeader } from "~/components/page-header";

export default function AppsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Apps"
        description="Route a domain's traffic through a device you choose."
      />
      <ConnectorsList />
    </div>
  );
}
