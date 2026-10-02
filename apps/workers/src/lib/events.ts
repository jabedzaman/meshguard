import type { Worker } from "bullmq";
import { logger } from "~/lib/logger";

/** Logs each worker's lifecycle and job outcomes. */
export function logWorkerEvents<Data, Result, Name extends string>(
  worker: Worker<Data, Result, Name>,
) {
  const log = logger.child({ queue: worker.name });
  worker.on("ready", () => log.info("worker ready"));
  worker.on("active", (job) => log.info({ jobId: job.id, job: job.name }, "job started"));
  worker.on("completed", (job) => log.info({ jobId: job.id, job: job.name }, "job completed"));
  worker.on("failed", (job, err) =>
    log.error({ jobId: job?.id, job: job?.name, attempt: job?.attemptsMade, err }, "job failed"),
  );
  worker.on("error", (err) => log.error({ err }, "worker error"));
}
