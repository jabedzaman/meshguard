import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { EmailTemplate, EmailTemplateProps } from "@mesh/emails";
import { QUEUES } from "~/queues";

/** One job per email; the job name is the template. */
export type EmailJobData<T extends EmailTemplate = EmailTemplate> = {
  to: string;
  props: EmailTemplateProps[T];
};

export function createEmailQueue(connection: Redis) {
  const queue = new Queue<EmailJobData, void, EmailTemplate>(QUEUES.EMAIL, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  return {
    queue,
    /** Queues an email; the workers app renders and sends it. */
    enqueue<T extends EmailTemplate>(template: T, data: EmailJobData<T>) {
      return queue.add(template, data);
    },
  };
}

export type EmailQueue = ReturnType<typeof createEmailQueue>;
