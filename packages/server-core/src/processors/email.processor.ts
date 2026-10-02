import type { Job } from "bullmq";
import { type EmailTemplate, renderEmail } from "@mesh/emails";
import type { Mailer } from "~/lib/mailer";
import type { EmailJobData } from "~/queues/email.queue";

/** Renders the job's template and sends it. Runs in the workers app. */
export async function processEmailJob(job: Job<EmailJobData, void, EmailTemplate>, mailer: Mailer) {
  const { subject, html, text } = await renderEmail(job.name, job.data.props);
  await mailer.send({ to: job.data.to, subject, html, text });
}
