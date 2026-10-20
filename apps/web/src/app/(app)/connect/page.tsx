import type { Metadata } from "next";
import { ConnectDevice } from "~/components/connect-device";
import { PageHeader } from "~/components/page-header";
import { orgUrl } from "~/lib/org-host";
import { listOrganizations } from "~/lib/session";

export const metadata: Metadata = { title: "Connect a device" };

export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const { login } = await searchParams;
  const id = typeof login === "string" ? login : "";
  const organizations = (await listOrganizations()).map(({ id: orgId, name, slug }) => ({
    id: orgId,
    name,
    // Another origin when organizations get subdomains; keep the login link.
    url: orgUrl(slug, `/connect?login=${encodeURIComponent(id)}`),
  }));
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Connect a device"
        description="Approve a device that ran meshguard up. It joins as yours."
      />
      <ConnectDevice id={id} organizations={organizations} />
    </div>
  );
}
