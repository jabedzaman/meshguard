export type DeviceStatus = "online" | "offline" | "unknown";

export type Platform = "darwin" | "linux" | "windows";

export interface Device {
  id: string;
  networkId: string;
  name: string;
  hostname: string;
  platform: Platform;
  meshIpv4: string | null;
  meshIpv6: string | null;
  wireguardPublicKey: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
}

export interface Network {
  id: string;
  organizationId: string;
  name: string;
  ipv4Cidr: string;
  ipv6Cidr: string;
}
