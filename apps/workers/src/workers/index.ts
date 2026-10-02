import type { Redis } from "ioredis";
import type { Mailer } from "@mesh/server-core";
import { createEmailWorker } from "~/workers/email.worker";

export interface WorkerDeps {
  redis: Redis;
  mailer: Mailer;
}

export function startWorkers({ redis, mailer }: WorkerDeps) {
  const workers = [createEmailWorker(redis, mailer)];
  return {
    workers,
    /** Waits for running jobs to finish, then stops taking new ones. */
    close: () => Promise.all(workers.map((worker) => worker.close())),
  };
}
