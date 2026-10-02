import type { Redis } from "ioredis";
import type { DeviceEvents, Mailer } from "@meshguard/server-core";
import { createEmailWorker } from "~/workers/email.worker";
import { startPresenceExpiryListener } from "~/workers/presence-expiry";

export interface WorkerDeps {
  redis: Redis;
  mailer: Mailer;
  deviceEvents: DeviceEvents;
}

export async function startWorkers({ redis, mailer, deviceEvents }: WorkerDeps) {
  const workers = [createEmailWorker(redis, mailer)];
  const presenceExpiry = await startPresenceExpiryListener(redis, deviceEvents);
  return {
    workers,
    /** Waits for running jobs to finish, then stops taking new ones. */
    close: async () => {
      await presenceExpiry.close();
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}
