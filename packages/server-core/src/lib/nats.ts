import { connect, type NatsConnection } from "@nats-io/transport-node";
import { createLogger } from "@mesh/utils";

const logger = createLogger("nats");

export type { NatsConnection };

/** NATS connection for real-time events. Keeps reconnecting if the server goes away. */
export async function createNats(url: string, name: string) {
  const nc = await connect({ servers: url, name, maxReconnectAttempts: -1 });
  void (async () => {
    for await (const status of nc.status()) {
      if (status.type === "disconnect" || status.type === "reconnect") {
        logger.warn({ status: status.type }, "nats connection changed");
      }
    }
  })();
  return nc;
}
