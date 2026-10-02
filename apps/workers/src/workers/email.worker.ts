import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { EmailTemplate } from "@meshguard/emails";
import { type EmailJobData, type Mailer, processEmailJob, QUEUES } from "@meshguard/server-core";
import { logWorkerEvents } from "~/lib/events";

export function createEmailWorker(connection: Redis, mailer: Mailer) {
  const worker = new Worker<EmailJobData, void, EmailTemplate>(
    QUEUES.EMAIL,
    (job) => processEmailJob(job, mailer),
    {
      connection,
      concurrency: 5,
    },
  );
  logWorkerEvents(worker);
  return worker;
}
