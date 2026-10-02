import type { NatsConnection } from "@nats-io/transport-node";
import { createLogger } from "@meshguard/utils";

const logger = createLogger("device-events");

export const DEVICE_EVENT_TYPES = [
  "enrolled",
  "connected",
  "updated",
  "disconnected",
  "removed",
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

/** A change to a device. Hints only: listeners re-read the device list. */
export interface DeviceEvent {
  type: DeviceEventType;
  networkId: string;
  deviceId: string;
}

/** NATS subject for a network's device events, e.g. network.<id>.device.connected. */
export function deviceEventSubject(networkId: string, type: DeviceEventType | "*" = "*") {
  return `network.${networkId}.device.${type}`;
}

export class DeviceEvents {
  constructor(private readonly nc: NatsConnection) {}

  /** Fire and forget: a lost event only delays a UI update, so it never fails the caller. */
  publish(event: DeviceEvent) {
    try {
      this.nc.publish(deviceEventSubject(event.networkId, event.type), JSON.stringify(event));
    } catch (err) {
      logger.warn({ err, event }, "device event not published");
    }
  }

  /** Every device event in the network until `close` is called. */
  subscribe(networkId: string) {
    const sub = this.nc.subscribe(deviceEventSubject(networkId));
    return {
      async *[Symbol.asyncIterator]() {
        for await (const msg of sub) yield msg.json<DeviceEvent>();
      },
      close: () => sub.unsubscribe(),
    };
  }
}
