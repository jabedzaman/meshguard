import { NetworkOverview } from "~/components/network-overview";
import { AttentionStrip, GettingStarted } from "~/components/overview-guidance";

export default function OverviewPage() {
  return (
    <>
      <AttentionStrip />
      <GettingStarted />
      <NetworkOverview />
    </>
  );
}
