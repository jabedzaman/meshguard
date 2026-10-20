import { AddDeviceDialog } from "~/components/add-device-dialog";
import { DevicePolicy } from "~/components/device-policy";
import { DevicesList } from "~/components/devices-list";
import { EnrollmentTokensList } from "~/components/enrollment-tokens-list";
import { PageHeader } from "~/components/page-header";

export default function DevicesPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Devices"
        description="Machines in your network reach each other by name."
        action={<AddDeviceDialog />}
      />
      <DevicesList />
      <DevicePolicy />
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Active enrollment tokens</h2>
        <EnrollmentTokensList />
      </section>
    </div>
  );
}
