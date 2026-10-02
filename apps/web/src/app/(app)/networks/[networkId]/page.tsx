import { NetworkDetail } from "~/components/network-detail";

export default async function NetworkPage({ params }: PageProps<"/networks/[networkId]">) {
  const { networkId } = await params;
  return <NetworkDetail networkId={networkId} />;
}
