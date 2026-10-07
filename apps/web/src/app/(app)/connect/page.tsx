import type { Metadata } from "next";
import { ConnectDevice } from "~/components/connect-device";
import { PageHeader } from "~/components/page-header";

export const metadata: Metadata = { title: "Connect a device" };

export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const { login } = await searchParams;
  return (
    <div className="flex max-w-xl flex-col gap-8">
      <PageHeader
        title="Connect a device"
        description="Approve a device that ran meshguard up. It joins as yours."
      />
      <ConnectDevice id={typeof login === "string" ? login : ""} />
    </div>
  );
}
