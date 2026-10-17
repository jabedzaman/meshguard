import { AccessRules } from "~/components/access-rules";
import { PageHeader } from "~/components/page-header";

export default function AccessPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Access" description="Which devices may reach which." />
      <AccessRules />
    </div>
  );
}
